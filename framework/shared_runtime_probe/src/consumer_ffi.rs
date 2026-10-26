#[link(name = "te2_probe_runtime_ffi")]
unsafe extern "C" {
    fn te2_probe_abi_version() -> u32;
    fn te2_probe_run_v1(
        label: *const u8,
        len: usize,
        output: *mut u8,
        capacity: usize,
        written: *mut usize,
    ) -> i32;
}

fn main() {
    // SAFETY: these declarations match the versioned header; buffers are local,
    // disjoint, bounded and live for the whole call. No Rust object crosses ABI.
    let (status, bytes) = unsafe {
        if te2_probe_abi_version() != 1 {
            eprintln!("unsupported runtime ABI");
            std::process::exit(1);
        }
        let label = env!("PROBE_LABEL").as_bytes();
        let mut buffer = [0_u8; 4096];
        let mut written = 0;
        let status = te2_probe_run_v1(
            label.as_ptr(),
            label.len(),
            buffer.as_mut_ptr(),
            buffer.len(),
            &mut written,
        );
        if written > buffer.len() {
            eprintln!("runtime output exceeds fixed capacity; no retry");
            std::process::exit(1);
        }
        (status, buffer[..written].to_vec())
    };
    let text = std::str::from_utf8(&bytes).expect("runtime returned invalid UTF-8");
    if status != 0 {
        eprintln!("runtime status {status}: {text}");
        std::process::exit(1);
    }
    println!("{text}");
}
