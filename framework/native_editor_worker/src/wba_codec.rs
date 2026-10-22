//! Bounded concatenated MessagePack records for the WBA control pipe.
//!
//! A decoder belongs to one stdout subscription. Dropping it on shell replacement
//! discards any partial record rather than joining bytes from different shells.
use crate::{decode, protocol::FRAME_LIMIT};
use anyhow::{Result, bail};
use rmpv::Value;
use std::io::{self, Cursor};

#[derive(Default)]
pub struct Stream {
    pending: Vec<u8>,
}

impl Stream {
    pub fn feed(&mut self, chunk: &[u8]) -> Result<Vec<Value>> {
        self.feed_with(chunk, |value, _wire| value)
    }

    pub fn feed_frames(&mut self, chunk: &[u8]) -> Result<Vec<Vec<u8>>> {
        self.feed_with(chunk, |_value, wire| wire.to_vec())
    }

    fn feed_with<T>(
        &mut self,
        chunk: &[u8],
        project: impl Fn(Value, &[u8]) -> T,
    ) -> Result<Vec<T>> {
        let mut records = Vec::new();
        let mut offset = 0;
        // A chunk may contain several complete records. Bound the unfinished
        // record, not the sum of independent records in one read.
        for part in chunk.chunks(FRAME_LIMIT.min(65_536)) {
            self.pending.extend_from_slice(part);
            loop {
                if offset == self.pending.len() {
                    self.pending.clear();
                    offset = 0;
                    break;
                }
                let mut cursor = Cursor::new(&self.pending[offset..]);
                match decode::read_frame(&mut cursor) {
                    Ok((value, size)) => {
                        records.push(project(value, &self.pending[offset..offset + size]));
                        offset += size;
                    }
                    Err(error)
                        if error.chain().any(|cause| {
                            cause
                                .downcast_ref::<io::Error>()
                                .is_some_and(|io| io.kind() == io::ErrorKind::UnexpectedEof)
                        }) =>
                    {
                        if self.pending.len() - offset > FRAME_LIMIT {
                            bail!("WBA pipe record exceeds byte limit");
                        }
                        if offset != 0 {
                            self.pending.drain(..offset);
                            offset = 0;
                        }
                        break;
                    }
                    Err(error) => return Err(error),
                }
            }
        }
        Ok(records)
    }

    pub fn finish(&self) -> Result<()> {
        if !self.pending.is_empty() {
            bail!("Truncated WBA pipe record at EOF");
        }
        Ok(())
    }
}

pub fn encode(value: &Value) -> Result<Vec<u8>> {
    struct Limited(Vec<u8>);
    impl io::Write for Limited {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            if bytes.len() > FRAME_LIMIT.saturating_sub(self.0.len()) {
                return Err(io::Error::other("WBA pipe record exceeds byte limit"));
            }
            self.0.extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    let mut buffer = Limited(Vec::new());
    rmpv::encode::write_value(&mut buffer, value)?;
    Ok(buffer.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fragmented_and_concatenated_records_preserve_order() {
        let records = [Value::from("first"), Value::from(42)];
        let wire: Vec<u8> = records.iter().flat_map(|v| encode(v).unwrap()).collect();
        let mut stream = Stream::default();
        let mut decoded = Vec::new();
        for byte in wire.chunks(1) {
            decoded.extend(stream.feed(byte).unwrap());
        }
        stream.finish().unwrap();
        assert_eq!(decoded, records);
        assert_eq!(stream.feed(&wire).unwrap(), records);
    }

    #[test]
    fn malformed_truncated_and_oversized_records_fail() {
        assert!(Stream::default().feed(&[0xc1]).is_err());
        let mut truncated = Stream::default();
        assert!(truncated.feed(&[0x81]).unwrap().is_empty());
        assert!(truncated.finish().is_err());
        assert!(
            Stream::default()
                .feed(&[0xc6, 0xff, 0xff, 0xff, 0xff])
                .is_err()
        );
    }

    #[test]
    fn original_frames_keep_encoding_fragmentation_and_replacement_fences() {
        let first = b"\x81\xa1x\xcd\x00\x01".to_vec();
        let second = encode(&Value::Binary(vec![0xc1; 70_000])).unwrap();
        let wire = [first.clone(), second.clone()].concat();
        for chunk_size in [4096, 65_536, wire.len()] {
            let mut frames = Stream::default();
            let mut graph = Stream::default();
            let mut result = Vec::new();
            let mut expected = Vec::new();
            for chunk in wire.chunks(chunk_size) {
                result.extend(frames.feed_frames(chunk).unwrap());
                expected.extend(graph.feed(chunk).unwrap());
            }
            frames.finish().unwrap();
            graph.finish().unwrap();
            assert_eq!(result, vec![first.clone(), second.clone()]);
            let decoded: Vec<Value> = result
                .iter()
                .map(|bytes| decode::read_frame(&mut bytes.as_slice()).unwrap().0)
                .collect();
            assert_eq!(decoded, expected);
        }
        let mut old = Stream::default();
        for byte in first[..first.len() - 1].chunks(1) {
            assert!(old.feed_frames(byte).unwrap().is_empty());
        }
        assert!(old.finish().is_err());
        let mut replacement = Stream::default();
        assert_eq!(replacement.feed_frames(&first).unwrap(), vec![first]);
        replacement.finish().unwrap();
    }

    #[test]
    fn frame_projection_keeps_the_same_guard_and_batch_error_semantics() {
        let mut deep = vec![0x91; 66];
        deep.push(0xc0);
        for bad in [
            vec![0xc1],
            vec![0xa1, 0xff],
            vec![0xd4, 0, 0],
            vec![0x81, 1, 0],
            vec![0x82, 0xa1, b'x', 0, 0xa1, b'x', 1],
            vec![0xc6, 0xff, 0xff, 0xff, 0xff],
            deep,
        ] {
            let wire = [vec![0x80], bad].concat();
            let graph = Stream::default().feed(&wire).unwrap_err().to_string();
            let frames = Stream::default()
                .feed_frames(&wire)
                .unwrap_err()
                .to_string();
            assert_eq!(graph, frames);
        }
    }
}
