use ckb_mmr_wasm::generate_root_with_proof;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let calldata_bytes: Vec<u8> = (0..32).map(|i| i as u8).collect();
    let tree_size = 100u64;
    let root_with_proof = generate_root_with_proof(&calldata_bytes, tree_size).unwrap();
    println!("{}", root_with_proof);
    Ok(())
}
