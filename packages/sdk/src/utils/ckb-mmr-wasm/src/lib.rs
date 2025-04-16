use ckb_merkle_mountain_range::{util::MemStore, Merge, Result as CkbResult, MMR};
use hex;
use tiny_keccak::{Hasher, Keccak};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsError;

#[wasm_bindgen]
#[derive(Debug)]
struct KeccakMerge;
impl Merge for KeccakMerge {
    type Item = Vec<u8>;
    fn merge(lhs: &Self::Item, rhs: &Self::Item) -> CkbResult<Self::Item> {
        let mut input = Vec::new();
        input.extend_from_slice(lhs);
        input.extend_from_slice(rhs);

        let mut keccak = Keccak::v256();
        let mut result = [0u8; 32];
        keccak.update(&input);
        keccak.finalize(&mut result);

        Ok(result.to_vec())
    }
}

fn is_leaf(pos: u64) -> bool {
    pos & (pos + 1) == 0
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    format!("0x{}", hex::encode(bytes))
}

fn bytes_to_hex_proof(bytes: &[Vec<u8>]) -> Vec<String> {
    let mut proof_items = Vec::new();
    for item in bytes {
        proof_items.push(bytes_to_hex(item));
    }

    proof_items
}

#[wasm_bindgen]
pub fn generate_root(calldata_bytes: &[u8]) -> Result<(String), JsError> {
    let store = MemStore::<Vec<u8>>::default();
    let mut mmr = MMR::<Vec<u8>, KeccakMerge, &MemStore<Vec<u8>>>::new(0, &store);
    let mut leaf_positions = Vec::new();

    for i in 0..100 {
        if i == 99 {
            let tx = calldata_bytes.to_vec();
            let pos = mmr.push(tx)?;
            leaf_positions.push(pos);
        } else {
            let mut tx = calldata_bytes.to_vec();
            for j in 0..tx.len() {
                tx[j] ^= i as u8;
            }
            mmr.push(tx)?;
        }
    }

    let root = mmr.get_root()?;

    let root_hex = bytes_to_hex(&root);

    mmr.commit()?;

    Ok(root_hex)
}

#[wasm_bindgen]
pub fn generate_proof(calldata_bytes: &[u8]) -> Result<Vec<String>, JsError> {
    let store = MemStore::<Vec<u8>>::default();
    let mut mmr = MMR::<Vec<u8>, KeccakMerge, &MemStore<Vec<u8>>>::new(0, &store);
    let mut leaf_positions = Vec::new();

    for i in 0..100 {
        if i == 99 {
            let tx = calldata_bytes.to_vec();
            let pos = mmr.push(tx)?;
            leaf_positions.push(pos);
        } else {
            let mut tx = calldata_bytes.to_vec();
            for j in 0..tx.len() {
                tx[j] ^= i as u8;
            }
            mmr.push(tx)?;
        }
    }

    let proof = mmr.gen_proof(leaf_positions)?;

    let proof_hex = bytes_to_hex_proof(proof.proof_items());

    mmr.commit()?;

    Ok(proof_hex)
}
