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
                        offset += size;
                        records.push(value);
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
}
