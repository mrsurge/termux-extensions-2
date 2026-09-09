//! Pure, bounded edit computation. Persistence belongs to a separate guarded
//! transaction: a successful computation is not permission to overwrite a file.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub(crate) const MAX_TEXT_BYTES: usize = 375 * 1024;
const MAX_EDITS: usize = 10_000;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TextEdit {
    // Offsets are UTF-8 bytes in the original snapshot, never evolving offsets
    // or Monaco UTF-16 columns. Producers must convert before requesting edits.
    pub(crate) start_byte: usize,
    pub(crate) end_byte: usize,
    pub(crate) expected_text: String,
    pub(crate) replacement: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TextEditsRequest {
    pub(crate) dto: String,
    pub(crate) version: u16,
    pub(crate) content: String,
    pub(crate) expected_sha256: String,
    pub(crate) edits: Vec<TextEdit>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextEditsResult {
    dto: &'static str,
    version: u16,
    pub(crate) content: String,
    pub(crate) source_sha256: String,
    pub(crate) content_sha256: String,
    pub(crate) changed: bool,
    pub(crate) applied_edits: usize,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum EditError {
    Contract,
    Limit,
    InvalidHash,
    StaleContent,
    InvalidRange,
    Overlap,
    ExpectedTextMismatch,
    Unavailable,
    InvalidPath,
    UnsupportedEncoding,
    Io,
}

impl EditError {
    pub(crate) fn code(&self) -> &'static str {
        match self {
            Self::Contract => "textEdit.invalidContract",
            Self::Limit => "textEdit.limitExceeded",
            Self::InvalidHash => "textEdit.invalidHash",
            Self::StaleContent => "textEdit.staleContent",
            Self::InvalidRange => "textEdit.invalidRange",
            Self::Overlap => "textEdit.overlap",
            Self::ExpectedTextMismatch => "textEdit.expectedTextMismatch",
            Self::Unavailable => "textEdit.unavailable",
            Self::InvalidPath => "textEdit.invalidPath",
            Self::UnsupportedEncoding => "textEdit.unsupportedEncoding",
            Self::Io => "textEdit.io",
        }
    }
}

pub(crate) fn sha256(content: &str) -> String {
    format!("{:x}", Sha256::digest(content.as_bytes()))
}

pub(crate) fn compute(mut request: TextEditsRequest) -> Result<TextEditsResult, EditError> {
    if request.dto != "TextEditsRequest" || request.version != 1 {
        return Err(EditError::Contract);
    }
    if request.content.len() > MAX_TEXT_BYTES || request.edits.len() > MAX_EDITS {
        return Err(EditError::Limit);
    }
    if request.expected_sha256.len() != 64
        || !request
            .expected_sha256
            .bytes()
            .all(|b| b.is_ascii_hexdigit())
    {
        return Err(EditError::InvalidHash);
    }
    let source_sha256 = sha256(&request.content);
    if !source_sha256.eq_ignore_ascii_case(&request.expected_sha256) {
        return Err(EditError::StaleContent);
    }
    request
        .edits
        .sort_by_key(|edit| (edit.start_byte, edit.end_byte));
    let mut previous: Option<&TextEdit> = None;
    let mut output_len = request.content.len();
    let mut payload_bytes = 0usize;
    for edit in &request.edits {
        payload_bytes = payload_bytes
            .checked_add(edit.expected_text.len())
            .and_then(|n| n.checked_add(edit.replacement.len()))
            .ok_or(EditError::Limit)?;
        if payload_bytes > MAX_TEXT_BYTES * 2 {
            return Err(EditError::Limit);
        }
        let original = request
            .content
            .get(edit.start_byte..edit.end_byte)
            .ok_or(EditError::InvalidRange)?;
        // Same-position insertions are ambiguous; adjacent nonoverlapping edits
        // are valid. No partially applied text escapes if any edit is invalid.
        if previous.is_some_and(|p| edit.start_byte < p.end_byte || edit.start_byte == p.start_byte)
        {
            return Err(EditError::Overlap);
        }
        if original != edit.expected_text {
            return Err(EditError::ExpectedTextMismatch);
        }
        output_len = output_len
            .checked_sub(original.len())
            .and_then(|n| n.checked_add(edit.replacement.len()))
            .ok_or(EditError::Limit)?;
        previous = Some(edit);
    }
    if output_len > MAX_TEXT_BYTES {
        return Err(EditError::Limit);
    }
    // Build once from original slices, preserving BOM, CRLF, and all untouched
    // bytes verbatim. Replacement strings are literal, not regex expansion.
    let mut content = String::with_capacity(output_len);
    let mut cursor = 0;
    let mut applied_edits = 0;
    for edit in request.edits {
        content.push_str(&request.content[cursor..edit.start_byte]);
        content.push_str(&edit.replacement);
        cursor = edit.end_byte;
        applied_edits += usize::from(edit.expected_text != edit.replacement);
    }
    content.push_str(&request.content[cursor..]);
    Ok(TextEditsResult {
        dto: "TextEditsResult",
        version: 1,
        changed: content != request.content,
        content_sha256: sha256(&content),
        source_sha256,
        content,
        applied_edits,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn edit(start: usize, end: usize, expected: &str, replacement: &str) -> TextEdit {
        TextEdit {
            start_byte: start,
            end_byte: end,
            expected_text: expected.into(),
            replacement: replacement.into(),
        }
    }
    fn request(content: &str, edits: Vec<TextEdit>) -> TextEditsRequest {
        TextEditsRequest {
            dto: "TextEditsRequest".into(),
            version: 1,
            content: content.into(),
            expected_sha256: sha256(content),
            edits,
        }
    }
    fn fails(request: TextEditsRequest, error: EditError) {
        assert_eq!(compute(request).unwrap_err(), error);
    }

    #[test]
    fn edits_use_original_offsets_and_preserve_unrelated_text() {
        let result = compute(request(
            "abc def ghi",
            vec![edit(8, 11, "ghi", "G"), edit(0, 3, "abc", "longer")],
        ))
        .unwrap();
        assert_eq!(result.content, "longer def G");
        assert_eq!(result.applied_edits, 2);
        assert!(result.changed);
        assert_eq!(result.content_sha256, sha256(&result.content));
    }
    #[test]
    fn unicode_bom_and_mixed_line_endings_are_preserved() {
        let source = "\u{feff}a\r\n\u{1f600}\ne\u{301}";
        let result = compute(request(source, vec![edit(6, 10, "\u{1f600}", "Z")])).unwrap();
        assert_eq!(result.content, "\u{feff}a\r\nZ\ne\u{301}");
        fails(
            request(source, vec![edit(7, 10, "", "x")]),
            EditError::InvalidRange,
        );
    }
    #[test]
    fn stale_full_snapshot_and_wrong_match_are_rejected() {
        let mut r = request("new", vec![]);
        r.expected_sha256 = sha256("old");
        fails(r, EditError::StaleContent);
        fails(
            request("abc", vec![edit(0, 1, "b", "x")]),
            EditError::ExpectedTextMismatch,
        );
    }
    #[test]
    fn invalid_ranges_and_overlaps_are_rejected() {
        fails(
            request("abc", vec![edit(2, 1, "", "x")]),
            EditError::InvalidRange,
        );
        fails(
            request("abc", vec![edit(0, 4, "", "x")]),
            EditError::InvalidRange,
        );
        fails(
            request("abc", vec![edit(0, 2, "ab", "x"), edit(1, 3, "bc", "y")]),
            EditError::Overlap,
        );
        fails(
            request("abc", vec![edit(1, 1, "", "x"), edit(1, 1, "", "y")]),
            EditError::Overlap,
        );
    }
    #[test]
    fn adjacent_edits_insertions_deletions_and_literal_replacements() {
        let result = compute(request(
            "abc",
            vec![
                edit(0, 1, "a", ""),
                edit(1, 2, "b", "$1"),
                edit(3, 3, "", "\n"),
            ],
        ))
        .unwrap();
        assert_eq!(result.content, "$1c\n");
    }
    #[test]
    fn noop_and_empty_input() {
        let result = compute(request("a", vec![edit(0, 1, "a", "a")])).unwrap();
        assert!(!result.changed);
        assert_eq!(result.applied_edits, 0);
        assert_eq!(
            compute(request("", vec![edit(0, 0, "", "x")]))
                .unwrap()
                .content,
            "x"
        );
    }
    #[test]
    fn contracts_and_limits_are_enforced() {
        let mut r = request("", vec![]);
        r.version = 2;
        fails(r, EditError::Contract);
        let mut r = request("", vec![]);
        r.expected_sha256 = "wrong".into();
        fails(r, EditError::InvalidHash);
        fails(
            request(&"x".repeat(MAX_TEXT_BYTES + 1), vec![]),
            EditError::Limit,
        );
        fails(
            request("", vec![edit(0, 0, "", &"x".repeat(MAX_TEXT_BYTES + 1))]),
            EditError::Limit,
        );
        fails(
            request("", (0..=MAX_EDITS).map(|_| edit(0, 0, "", "")).collect()),
            EditError::Limit,
        );
    }
    #[test]
    fn every_unicode_boundary_range_matches_reference_replacement() {
        let source = "a\u{1f600}e\u{301}\r\nz";
        let boundaries: Vec<_> = source
            .char_indices()
            .map(|(i, _)| i)
            .chain([source.len()])
            .collect();
        for &start in &boundaries {
            for &end in boundaries.iter().filter(|&&end| end >= start) {
                for replacement in ["", "X", "\r\n", "\u{1f600}"] {
                    let mut expected = source.to_owned();
                    expected.replace_range(start..end, replacement);
                    let result = compute(request(
                        source,
                        vec![edit(start, end, &source[start..end], replacement)],
                    ))
                    .unwrap();
                    assert_eq!(result.content, expected);
                }
            }
        }
    }

    #[test]
    fn unknown_fields_are_not_silently_accepted() {
        assert!(serde_json::from_value::<TextEditsRequest>(serde_json::json!({
            "dto":"TextEditsRequest","version":1,"content":"","expectedSha256":sha256(""),"edits":[],"path":"do-not-write"
        })).is_err());
    }
}
