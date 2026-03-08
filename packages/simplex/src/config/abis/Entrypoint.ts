export const ENTRYPOINT_ABI = [
	{
		inputs: [
			{ name: "sender", type: "address" },
			{ name: "key", type: "uint192" },
		],
		name: "getNonce",
		outputs: [{ name: "nonce", type: "uint256" }],
		stateMutability: "view",
		type: "function",
	},
	{
		inputs: [{ name: "account", type: "address" }],
		name: "balanceOf",
		outputs: [{ name: "", type: "uint256" }],
		stateMutability: "view",
		type: "function",
	},
	{
		inputs: [{ name: "account", type: "address" }],
		name: "depositTo",
		outputs: [],
		stateMutability: "payable",
		type: "function",
	},
] as const
