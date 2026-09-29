//! Bounded one-pass MessagePack values. Reserved markers never become nil.
use crate::protocol::FRAME_LIMIT;
use anyhow::{Result, bail};
use rmpv::Value;
use std::io::Read;

pub fn read_frame(reader: &mut impl Read) -> Result<(Value, usize)> {
    let mut decoder = Decoder {
        reader,
        remaining: FRAME_LIMIT,
        nodes: 1_000_000,
    };
    let value = decoder.value(0)?;
    Ok((value, FRAME_LIMIT - decoder.remaining))
}

struct Decoder<'a, R> {
    reader: &'a mut R,
    remaining: usize,
    nodes: usize,
}
impl<R: Read> Decoder<'_, R> {
    fn bytes(&mut self, size: usize) -> Result<Vec<u8>> {
        if size > self.remaining {
            bail!("frame byte limit exceeded");
        }
        self.remaining -= size;
        let mut bytes = vec![0; size];
        self.reader.read_exact(&mut bytes)?;
        Ok(bytes)
    }
    fn number(&mut self, size: usize) -> Result<u64> {
        if size > self.remaining {
            bail!("frame byte limit exceeded");
        }
        self.remaining -= size;
        let mut bytes = [0; 8];
        self.reader.read_exact(&mut bytes[8 - size..])?;
        Ok(u64::from_be_bytes(bytes))
    }
    fn string(&mut self, size: usize) -> Result<Value> {
        Ok(Value::from(String::from_utf8(self.bytes(size)?)?))
    }
    fn array(&mut self, size: usize, depth: usize) -> Result<Value> {
        if size > self.nodes {
            bail!("container node budget exceeded");
        }
        let mut values = Vec::with_capacity(size.min(1024));
        for _ in 0..size {
            values.push(self.value(depth + 1)?);
        }
        Ok(Value::Array(values))
    }
    fn map(&mut self, size: usize, depth: usize) -> Result<Value> {
        if size > self.nodes / 2 {
            bail!("container node budget exceeded");
        }
        let mut entries = Vec::with_capacity(size.min(1024));
        let mut keys = std::collections::HashSet::new();
        for _ in 0..size {
            let key = self.value(depth + 1)?;
            let text = key
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("map keys must be UTF-8 strings"))?;
            if !keys.insert(text.to_owned()) {
                bail!("duplicate map key");
            }
            entries.push((key, self.value(depth + 1)?));
        }
        Ok(Value::Map(entries))
    }
    fn value(&mut self, depth: usize) -> Result<Value> {
        if depth > 64 || self.nodes == 0 {
            bail!("value depth/node budget exceeded");
        }
        self.nodes -= 1;
        let marker = self.number(1)? as u8;
        Ok(match marker {
            0x00..=0x7f => Value::from(marker),
            0x80..=0x8f => self.map((marker & 15) as usize, depth)?,
            0x90..=0x9f => self.array((marker & 15) as usize, depth)?,
            0xa0..=0xbf => self.string((marker & 31) as usize)?,
            0xc0 => Value::Nil,
            0xc1 => bail!("reserved MessagePack marker"),
            0xc2 => Value::Boolean(false),
            0xc3 => Value::Boolean(true),
            0xc4..=0xc6 => {
                let size = self.number(1 << (marker - 0xc4))? as usize;
                Value::Binary(self.bytes(size)?)
            }
            0xca => Value::F32(f32::from_bits(self.number(4)? as u32)),
            0xcb => Value::F64(f64::from_bits(self.number(8)?)),
            0xcc..=0xcf => Value::from(self.number(1 << (marker - 0xcc))?),
            0xd0..=0xd3 => {
                let size = 1 << (marker - 0xd0);
                let value = self.number(size)?;
                let shift = 64 - size * 8;
                Value::from(((value << shift) as i64) >> shift)
            }
            0xd9..=0xdb => {
                let size = self.number(1 << (marker - 0xd9))? as usize;
                self.string(size)?
            }
            0xdc..=0xdd => {
                let size = self.number(if marker == 0xdc { 2 } else { 4 })? as usize;
                self.array(size, depth)?
            }
            0xde..=0xdf => {
                let size = self.number(if marker == 0xde { 2 } else { 4 })? as usize;
                self.map(size, depth)?
            }
            0xe0..=0xff => Value::from(marker as i8),
            _ => bail!("MessagePack extension marker unsupported"),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_reserved_nested_and_huge_lengths_before_allocation() {
        for bytes in [
            &b"\x91\xc1"[..],
            &b"\xc6\xff\xff\xff\xff"[..],
            &b"\xdf\xff\xff\xff\xff"[..],
        ] {
            assert!(read_frame(&mut &*bytes).is_err());
        }
    }
    #[test]
    fn preserves_binary_markers_and_concatenated_frames() {
        let mut data = &b"\xc4\x02\xc1\xff\x81\xa1x\xd1\xff\x00"[..];
        assert_eq!(
            read_frame(&mut data).unwrap().0,
            Value::Binary(vec![0xc1, 0xff])
        );
        assert_eq!(
            read_frame(&mut data).unwrap().0,
            Value::Map(vec![("x".into(), (-256).into())])
        );
        assert!(data.is_empty());
    }
}
