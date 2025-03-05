// SPDX-License-Identifier: Apache-2.0

// Auto-generated , DO NOT EDIT
import {EthereumLog, EthereumTransaction, LightEthereumLog} from "@subql/types-ethereum";

import {GetRequestEventEvent, GetRequestHandledEvent, GetRequestTimeoutHandledEvent, HostFrozenEvent, HostParamsUpdatedEvent, HostWithdrawalEvent, PostRequestEventEvent, PostRequestHandledEvent, PostRequestTimeoutHandledEvent, PostResponseEventEvent, PostResponseFundedEvent, PostResponseHandledEvent, PostResponseTimeoutHandledEvent, RequestFundedEvent, StateCommitmentReadEvent, StateCommitmentVetoedEvent, StateMachineUpdatedEvent, EthereumHostAbi} from '../contracts/EthereumHostAbi'


export type GetRequestEventLog = EthereumLog<GetRequestEventEvent["args"]>

export type GetRequestHandledLog = EthereumLog<GetRequestHandledEvent["args"]>

export type GetRequestTimeoutHandledLog = EthereumLog<GetRequestTimeoutHandledEvent["args"]>

export type HostFrozenLog = EthereumLog<HostFrozenEvent["args"]>

export type HostParamsUpdatedLog = EthereumLog<HostParamsUpdatedEvent["args"]>

export type HostWithdrawalLog = EthereumLog<HostWithdrawalEvent["args"]>

export type PostRequestEventLog = EthereumLog<PostRequestEventEvent["args"]>

export type PostRequestHandledLog = EthereumLog<PostRequestHandledEvent["args"]>

export type PostRequestTimeoutHandledLog = EthereumLog<PostRequestTimeoutHandledEvent["args"]>

export type PostResponseEventLog = EthereumLog<PostResponseEventEvent["args"]>

export type PostResponseFundedLog = EthereumLog<PostResponseFundedEvent["args"]>

export type PostResponseHandledLog = EthereumLog<PostResponseHandledEvent["args"]>

export type PostResponseTimeoutHandledLog = EthereumLog<PostResponseTimeoutHandledEvent["args"]>

export type RequestFundedLog = EthereumLog<RequestFundedEvent["args"]>

export type StateCommitmentReadLog = EthereumLog<StateCommitmentReadEvent["args"]>

export type StateCommitmentVetoedLog = EthereumLog<StateCommitmentVetoedEvent["args"]>

export type StateMachineUpdatedLog = EthereumLog<StateMachineUpdatedEvent["args"]>


export type LightGetRequestEventLog = LightEthereumLog<GetRequestEventEvent["args"]>

export type LightGetRequestHandledLog = LightEthereumLog<GetRequestHandledEvent["args"]>

export type LightGetRequestTimeoutHandledLog = LightEthereumLog<GetRequestTimeoutHandledEvent["args"]>

export type LightHostFrozenLog = LightEthereumLog<HostFrozenEvent["args"]>

export type LightHostParamsUpdatedLog = LightEthereumLog<HostParamsUpdatedEvent["args"]>

export type LightHostWithdrawalLog = LightEthereumLog<HostWithdrawalEvent["args"]>

export type LightPostRequestEventLog = LightEthereumLog<PostRequestEventEvent["args"]>

export type LightPostRequestHandledLog = LightEthereumLog<PostRequestHandledEvent["args"]>

export type LightPostRequestTimeoutHandledLog = LightEthereumLog<PostRequestTimeoutHandledEvent["args"]>

export type LightPostResponseEventLog = LightEthereumLog<PostResponseEventEvent["args"]>

export type LightPostResponseFundedLog = LightEthereumLog<PostResponseFundedEvent["args"]>

export type LightPostResponseHandledLog = LightEthereumLog<PostResponseHandledEvent["args"]>

export type LightPostResponseTimeoutHandledLog = LightEthereumLog<PostResponseTimeoutHandledEvent["args"]>

export type LightRequestFundedLog = LightEthereumLog<RequestFundedEvent["args"]>

export type LightStateCommitmentReadLog = LightEthereumLog<StateCommitmentReadEvent["args"]>

export type LightStateCommitmentVetoedLog = LightEthereumLog<StateCommitmentVetoedEvent["args"]>

export type LightStateMachineUpdatedLog = LightEthereumLog<StateMachineUpdatedEvent["args"]>


export type CHAIN_IDTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['CHAIN_ID']>>

export type AdminTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['admin']>>

export type ChainIdTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['chainId']>>

export type ChallengePeriodTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['challengePeriod']>>

export type ConsensusClientTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['consensusClient']>>

export type ConsensusStateTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['consensusState']>>

export type ConsensusUpdateTimeTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['consensusUpdateTime']>>

export type DeleteStateMachineCommitmentTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['deleteStateMachineCommitment']>>

export type FeeTokenTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['feeToken']>>

export type FrozenTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['frozen']>>

export type FundRequestTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['fundRequest']>>

export type FundResponseTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['fundResponse']>>

export type HostTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['host']>>

export type HostParamsTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['hostParams']>>

export type HyperbridgeTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['hyperbridge']>>

export type LatestStateMachineHeightTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['latestStateMachineHeight']>>

export type NonceTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['nonce']>>

export type PerByteFeeTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['perByteFee']>>

export type RequestCommitmentsTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['requestCommitments']>>

export type RequestReceiptsTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['requestReceipts']>>

export type RespondedTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['responded']>>

export type ResponseCommitmentsTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['responseCommitments']>>

export type ResponseReceiptsTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['responseReceipts']>>

export type SetConsensusStateTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['setConsensusState']>>

export type SetFrozenStateTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['setFrozenState']>>

export type StateCommitmentFeeTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['stateCommitmentFee']>>

export type StateMachineCommitmentTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['stateMachineCommitment']>>

export type StateMachineCommitmentUpdateTimeTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['stateMachineCommitmentUpdateTime']>>

export type StateMachineIdTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['stateMachineId']>>

export type StoreConsensusStateTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['storeConsensusState']>>

export type StoreStateMachineCommitmentTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['storeStateMachineCommitment']>>

export type TimestampTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['timestamp']>>

export type UnStakingPeriodTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['unStakingPeriod']>>

export type UniswapV2RouterTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['uniswapV2Router']>>

export type UpdateHostParamsTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['updateHostParams']>>

export type VetoesTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['vetoes']>>

export type WithdrawTransaction = EthereumTransaction<Parameters<EthereumHostAbi['functions']['withdraw']>>

