//! Test-only incompatible library: clients must reject version before execution.
#[unsafe(no_mangle)]
pub extern "C" fn te2_probe_abi_version() -> u32 {
    2
}

#[unsafe(no_mangle)]
pub extern "C" fn te2_probe_run_v1(
    _: *const u8,
    _: usize,
    _: *mut u8,
    _: usize,
    _: *mut usize,
) -> i32 {
    -1
}
