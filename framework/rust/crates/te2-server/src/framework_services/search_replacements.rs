//! Prepare selected search occurrences against one immutable disk snapshot.
//! This producer never writes; draft consent and guarded apply remain separate.
use super::search_ops::{
    SearchContentRequest, build_content_matcher, build_multiline_content_matcher,
    is_multiline_query, strip_line_ending,
};
use super::text_edit_ops::{self, EditError, MAX_TEXT_BYTES, TextEdit, TextEditsRequest};
use grep_matcher::{Captures, Matcher};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PrepareReplaceRequest {
    pub(crate) dto: String,
    pub(crate) version: u16,
    pub(crate) root: String,
    pub(crate) path: String,
    pub(crate) expected_sha256: String,
    pub(crate) query: String,
    pub(crate) is_regex: bool,
    pub(crate) is_case_sensitive: bool,
    pub(crate) is_whole_words: bool,
    pub(crate) replacement: String,
    pub(crate) ranges: Vec<ReplaceRange>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReplaceRange {
    pub(crate) start_byte: usize,
    pub(crate) end_byte: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreparedReplaceResult {
    dto: &'static str,
    version: u16,
    path: String,
    source_sha256: String,
    edits: Vec<TextEdit>,
}

pub(crate) fn prepare(request: PrepareReplaceRequest) -> Result<PreparedReplaceResult, EditError> {
    if request.dto != "PrepareReplaceRequest" || request.version != 1 || request.query.is_empty() {
        return Err(EditError::Contract);
    }
    if request.query.len() > MAX_TEXT_BYTES
        || request.replacement.len() > MAX_TEXT_BYTES
        || request.ranges.is_empty()
        || request.ranges.len() > 700
    {
        return Err(EditError::Limit);
    }
    let root = std::fs::canonicalize(&request.root).map_err(|_| EditError::InvalidPath)?;
    let content = super::text_edit_disk::snapshot(&root, &request.path)?;
    let source = text_edit_ops::sha256(&content);
    if source != request.expected_sha256 {
        return Err(EditError::StaleContent);
    }
    let mut wanted: BTreeSet<(usize, usize)> = request
        .ranges
        .iter()
        .map(|range| (range.start_byte, range.end_byte))
        .collect();
    if wanted.len() != request.ranges.len()
        || wanted
            .iter()
            .any(|&(s, e)| s > e || content.get(s..e).is_none())
    {
        return Err(EditError::Contract);
    }
    let search = SearchContentRequest {
        query: request.query.clone(),
        is_regex: request.is_regex,
        is_case_sensitive: request.is_case_sensitive,
        is_whole_words: request.is_whole_words,
        ..Default::default()
    };
    let mut edits = Vec::new();
    let mut payload_bytes = 0usize;
    // Verify against the full matcher context, not against the isolated match:
    // anchors, whole-word boundaries and captures must match original search.
    let mut add = |start: usize, end: usize, replacement: String| -> Result<(), EditError> {
        let expected = content.get(start..end).ok_or(EditError::InvalidRange)?;
        payload_bytes = payload_bytes
            .saturating_add(expected.len())
            .saturating_add(replacement.len());
        if payload_bytes > 750 * 1024 {
            return Err(EditError::Limit);
        }
        edits.push(TextEdit {
            start_byte: start,
            end_byte: end,
            expected_text: expected.to_owned(),
            replacement,
        });
        Ok(())
    };
    if is_multiline_query(&request.query) {
        let matcher = build_multiline_content_matcher(&search).map_err(|_| EditError::Contract)?;
        for caps in matcher.captures_iter(&content) {
            let found = caps.get(0).ok_or(EditError::Contract)?;
            if wanted.remove(&(found.start(), found.end())) {
                let replacement = if request.is_regex {
                    expand(&request.replacement, |name| {
                        name.parse::<usize>()
                            .ok()
                            .and_then(|i| caps.get(i))
                            .or_else(|| caps.name(name))
                            .map(|m| m.as_str())
                    })?
                } else {
                    request.replacement.clone()
                };
                add(found.start(), found.end(), replacement)?;
            }
            if wanted.is_empty() {
                break;
            }
        }
    } else {
        // Search treats BOM/transcoded single-line files as display-only.
        if content.starts_with('\u{feff}') {
            return Err(EditError::UnsupportedEncoding);
        }
        let matcher = build_content_matcher(&search).map_err(|_| EditError::Contract)?;
        let mut caps = matcher.new_captures().map_err(|_| EditError::Contract)?;
        let mut offset = 0;
        for raw in content.as_bytes().split_inclusive(|b| *b == b'\n') {
            let line = strip_line_ending(raw);
            let mut failure = None;
            matcher
                .captures_iter(line, &mut caps, |caps| {
                    let Some(found) = caps.get(0) else {
                        return false;
                    };
                    let (start, end) = (offset + found.start(), offset + found.end());
                    if wanted.remove(&(start, end)) {
                        let replacement = if request.is_regex {
                            expand(&request.replacement, |name| {
                                name.parse::<usize>()
                                    .ok()
                                    .or_else(|| matcher.capture_index(name))
                                    .and_then(|i| caps.get(i))
                                    .and_then(|m| std::str::from_utf8(&line[m]).ok())
                            })
                        } else {
                            Ok(request.replacement.clone())
                        };
                        if let Err(error) = replacement.and_then(|value| add(start, end, value)) {
                            failure = Some(error);
                            return false;
                        }
                    }
                    !wanted.is_empty()
                })
                .map_err(|_| EditError::Contract)?;
            if let Some(error) = failure {
                return Err(error);
            }
            if wanted.is_empty() {
                break;
            }
            offset += raw.len();
        }
    }
    if !wanted.is_empty() {
        return Err(EditError::ExpectedTextMismatch);
    }
    // Validate aggregate overlap, output size and original text now, and again
    // during apply. Preparation does not grant permission for a later write.
    let validation = TextEditsRequest {
        dto: "TextEditsRequest".into(),
        version: 1,
        content,
        expected_sha256: source.clone(),
        edits,
    };
    let edits = validation
        .edits
        .iter()
        .map(|e| TextEdit {
            start_byte: e.start_byte,
            end_byte: e.end_byte,
            expected_text: e.expected_text.clone(),
            replacement: e.replacement.clone(),
        })
        .collect();
    text_edit_ops::compute(validation)?;
    Ok(PreparedReplaceResult {
        dto: "PreparedReplaceResult",
        version: 1,
        path: request.path,
        source_sha256: source,
        edits,
    })
}

// Bound capture expansion while constructing it, not after an unbounded expand.
// Supports $0/$1, ${name}, $name, $$ and $& (the complete match).
fn expand<'a>(
    template: &str,
    mut capture: impl FnMut(&str) -> Option<&'a str>,
) -> Result<String, EditError> {
    let mut out = String::new();
    let mut rest = template;
    while let Some(at) = rest.find('$') {
        append(&mut out, &rest[..at])?;
        rest = &rest[at + 1..];
        if let Some(tail) = rest.strip_prefix('$') {
            append(&mut out, "$")?;
            rest = tail;
            continue;
        }
        if let Some(tail) = rest.strip_prefix('&') {
            append(&mut out, capture("0").unwrap_or(""))?;
            rest = tail;
            continue;
        }
        let (name, consumed) = if rest.starts_with('{') {
            match rest.find('}') {
                Some(end) => (&rest[1..end], end + 1),
                None => ("", 0),
            }
        } else {
            let end = rest
                .bytes()
                .take_while(|b| b.is_ascii_alphanumeric() || *b == b'_')
                .count();
            (&rest[..end], end)
        };
        if consumed == 0 {
            append(&mut out, "$")?;
        } else {
            append(&mut out, capture(name).unwrap_or(""))?;
            rest = &rest[consumed..];
        }
    }
    append(&mut out, rest)?;
    Ok(out)
}

fn append(out: &mut String, value: &str) -> Result<(), EditError> {
    if out.len().saturating_add(value.len()) > MAX_TEXT_BYTES {
        return Err(EditError::Limit);
    }
    out.push_str(value);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(
        root: &std::path::Path,
        content: &str,
        query: &str,
        ranges: &[(usize, usize)],
    ) -> PrepareReplaceRequest {
        std::fs::write(root.join("test.txt"), content).unwrap();
        PrepareReplaceRequest {
            dto: "PrepareReplaceRequest".into(),
            version: 1,
            root: root.to_str().unwrap().into(),
            path: "test.txt".into(),
            expected_sha256: text_edit_ops::sha256(content),
            query: query.into(),
            is_regex: false,
            is_case_sensitive: true,
            is_whole_words: false,
            replacement: "new".into(),
            ranges: ranges
                .iter()
                .map(|&(start_byte, end_byte)| ReplaceRange {
                    start_byte,
                    end_byte,
                })
                .collect(),
        }
    }

    #[test]
    fn replace_prepare_second_hit_only_and_empty_deletion() {
        let root = tempfile::tempdir().unwrap();
        let content = "cat cat cat\r\n";
        let mut req = request(root.path(), content, "cat", &[(4, 7)]);
        req.replacement.clear();
        let result = prepare(req).unwrap();
        assert_eq!(result.edits.len(), 1);
        let output = text_edit_ops::compute(TextEditsRequest {
            dto: "TextEditsRequest".into(),
            version: 1,
            content: content.into(),
            expected_sha256: result.source_sha256,
            edits: result.edits,
        })
        .unwrap();
        assert_eq!(output.content, "cat  cat\r\n");
        assert_eq!(
            std::fs::read_to_string(root.path().join("test.txt")).unwrap(),
            content
        );
    }

    #[test]
    fn replace_prepare_regex_captures_and_multiline_crlf() {
        let root = tempfile::tempdir().unwrap();
        let mut req = request(root.path(), "cat42 cat7\r\n", r"cat(\d+)", &[(6, 10)]);
        req.is_regex = true;
        req.replacement = "$1-$$-$&".into();
        assert_eq!(prepare(req).unwrap().edits[0].replacement, "7-$-cat7");
        let mut req = request(root.path(), "cat\r\n42", "(cat)\n(42)", &[(0, 7)]);
        req.is_regex = true;
        req.replacement = "$2:$1".into();
        assert_eq!(prepare(req).unwrap().edits[0].replacement, "42:cat");
    }

    #[test]
    fn replace_prepare_rejects_stale_duplicate_and_nonmatch_ranges() {
        let root = tempfile::tempdir().unwrap();
        let req = request(root.path(), "cat cat", "cat", &[(0, 3)]);
        std::fs::write(root.path().join("test.txt"), "dog cat").unwrap();
        assert_eq!(prepare(req).unwrap_err(), EditError::StaleContent);
        let req = request(root.path(), "cat cat", "cat", &[(0, 3), (0, 3)]);
        assert_eq!(prepare(req).unwrap_err(), EditError::Contract);
        let req = request(root.path(), "cat cat", "cat", &[(1, 3)]);
        assert_eq!(prepare(req).unwrap_err(), EditError::ExpectedTextMismatch);
    }

    #[test]
    fn replace_prepare_zero_width_case_and_word_boundaries() {
        let root = tempfile::tempdir().unwrap();
        let mut req = request(root.path(), "Cat cater cat", "cat", &[(10, 13)]);
        req.is_case_sensitive = false;
        req.is_whole_words = true;
        assert_eq!(prepare(req).unwrap().edits[0].start_byte, 10);
        let mut req = request(root.path(), "cat", r"\b", &[(0, 0), (3, 3)]);
        req.is_regex = true;
        assert_eq!(prepare(req).unwrap().edits.len(), 2);
    }

    #[test]
    fn replace_prepare_capture_expansion_is_bounded() {
        let content = "x".repeat(MAX_TEXT_BYTES);
        assert_eq!(
            expand("$0$0", |_| Some(content.as_str())).unwrap_err(),
            EditError::Limit
        );
        assert_eq!(
            expand("${name}/$1/$$/$&", |name| match name {
                "name" => Some("a"),
                "1" => Some("b"),
                "0" => Some("ab"),
                _ => None,
            })
            .unwrap(),
            "a/b/$/ab"
        );
    }
}
