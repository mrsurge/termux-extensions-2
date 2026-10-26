fn main() {
    match te2_probe_runtime::run(env!("CARGO_BIN_NAME")) {
        Ok(report) => println!("{report}"),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
