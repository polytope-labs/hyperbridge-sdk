use ckb_mmr_wasm::{generate_proof, generate_root};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let calldata_bytes: Vec<u8> = (0..32).map(|i| i as u8).collect();

    let root = generate_root(&calldata_bytes).unwrap();
    let proof = generate_proof(&calldata_bytes).unwrap();
    println!("{}", root);
    println!("{:?}", proof);
    Ok(())
}
