#[path = "../../src/runtime.rs"]
mod runtime;

#[unsafe(no_mangle)]
pub extern "C" fn te2_probe_abi_version() -> u32 {
    1
}

/// Execute the same concrete networking fixture through a bounded byte ABI.
///
/// # Safety
/// Caller must supply valid, non-overlapping spans and an aligned writable
/// `written`. Buffers stay alive for this synchronous call. No Rust ownership,
/// allocator, Future or unwinding crosses the C ABI. Nulls/lengths are checked,
/// but arbitrary invalid non-null pointers cannot be validated by this API.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn te2_probe_run_v1(
    label: *const u8,
    label_len: usize,
    output: *mut u8,
    capacity: usize,
    written: *mut usize,
) -> i32 {
    if label.is_null()
        || output.is_null()
        || written.is_null()
        || label_len == 0
        || label_len > 128
        || capacity > 1024 * 1024
    {
        return -1;
    }
    // SAFETY: spans are covered by the caller contract; lengths are bounded.
    let label = unsafe { std::slice::from_raw_parts(label, label_len) };
    let Ok(label) = std::str::from_utf8(label) else {
        return -1;
    };
    let (status, result) = match std::panic::catch_unwind(|| runtime::run(label)) {
        Ok(Ok(value)) => (0, value),
        Ok(Err(error)) => (1, error),
        Err(_) => (-3, "runtime panic".to_owned()),
    };
    // SAFETY: caller owns the output and written pointers; capacity was bounded.
    unsafe {
        written.write(result.len());
    }
    if result.len() > capacity {
        return -2;
    }
    unsafe {
        std::ptr::copy_nonoverlapping(result.as_ptr(), output, result.len());
    }
    status
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn byte_contract_rejects_invalid_and_bounds_output() {
        assert_eq!(te2_probe_abi_version(), 1);
        let mut buffer = [0_u8; 256];
        let mut written = 0;
        unsafe {
            assert_eq!(
                te2_probe_run_v1(
                    std::ptr::null(),
                    1,
                    buffer.as_mut_ptr(),
                    buffer.len(),
                    &mut written
                ),
                -1
            );
            assert_eq!(
                te2_probe_run_v1(
                    [255_u8].as_ptr(),
                    1,
                    buffer.as_mut_ptr(),
                    buffer.len(),
                    &mut written
                ),
                -1
            );
            assert_eq!(
                te2_probe_run_v1(b"test".as_ptr(), 4, buffer.as_mut_ptr(), 1, &mut written),
                -2
            );
            assert!(written > 1);
            assert_eq!(
                te2_probe_run_v1(
                    b"test".as_ptr(),
                    4,
                    buffer.as_mut_ptr(),
                    buffer.len(),
                    &mut written
                ),
                0
            );
        }
        assert!(
            std::str::from_utf8(&buffer[..written])
                .unwrap()
                .starts_with("test: revision=")
        );
    }
}
