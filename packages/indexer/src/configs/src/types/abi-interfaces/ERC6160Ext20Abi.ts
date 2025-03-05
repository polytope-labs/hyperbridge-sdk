// SPDX-License-Identifier: Apache-2.0

// Auto-generated , DO NOT EDIT
import {EthereumLog, EthereumTransaction, LightEthereumLog} from "@subql/types-ethereum";

import {ApprovalEvent, TransferEvent, ERC6160Ext20Abi} from '../contracts/ERC6160Ext20Abi'


export type ApprovalLog = EthereumLog<ApprovalEvent["args"]>

export type TransferLog = EthereumLog<TransferEvent["args"]>


export type LightApprovalLog = LightEthereumLog<ApprovalEvent["args"]>

export type LightTransferLog = LightEthereumLog<TransferEvent["args"]>


export type BURNER_ROLETransaction = EthereumTransaction<Parameters<ERC6160Ext20Abi['functions']['BURNER_ROLE']>>

export type MINTER_ROLETransaction = EthereumTransaction<Parameters<ERC6160Ext20Abi['functions']['MINTER_ROLE']>>

export type AllowanceTransaction = EthereumTransaction<Parameters<ERC6160Ext20Abi['functions']['allowance']>>

export type ApproveTransaction = EthereumTransaction<Parameters<ERC6160Ext20Abi['functions']['approve']>>

export type BalanceOfTransaction = EthereumTransaction<Parameters<ERC6160Ext20Abi['functions']['balanceOf']>>

export type BurnTransaction = EthereumTransaction<Parameters<ERC6160Ext20Abi['functions']['burn']>>

export type ChangeAdminTransaction = EthereumTransaction<Parameters<ERC6160Ext20Abi['functions']['changeAdmin']>>

export type DecimalsTransaction = EthereumTransaction<Parameters<ERC6160Ext20Abi['functions']['decimals']>>

export type DecreaseAllowanceTransaction = EthereumTransaction<Parameters<ERC6160Ext20Abi['functions']['decreaseAllowance']>>

export type GetBurnerRoleTransaction = EthereumTransaction<Parameters<ERC6160Ext20Abi['functions']['getBurnerRole']>>

export type GetMinterRoleTransaction = EthereumTransaction<Parameters<ERC6160Ext20Abi['functions']['getMinterRole']>>

export type GrantRoleTransaction = EthereumTransaction<Parameters<ERC6160Ext20Abi['functions']['grantRole']>>

export type HasRoleTransaction = EthereumTransaction<Parameters<ERC6160Ext20Abi['functions']['hasRole']>>

export type IncreaseAllowanceTransaction = EthereumTransaction<Parameters<ERC6160Ext20Abi['functions']['increaseAllowance']>>

export type MintTransaction = EthereumTransaction<Parameters<ERC6160Ext20Abi['functions']['mint']>>

export type NameTransaction = EthereumTransaction<Parameters<ERC6160Ext20Abi['functions']['name']>>

export type RevokeRoleTransaction = EthereumTransaction<Parameters<ERC6160Ext20Abi['functions']['revokeRole']>>

export type SupportsInterfaceTransaction = EthereumTransaction<Parameters<ERC6160Ext20Abi['functions']['supportsInterface']>>

export type SymbolTransaction = EthereumTransaction<Parameters<ERC6160Ext20Abi['functions']['symbol']>>

export type TotalSupplyTransaction = EthereumTransaction<Parameters<ERC6160Ext20Abi['functions']['totalSupply']>>

export type TransferTransaction = EthereumTransaction<Parameters<ERC6160Ext20Abi['functions']['transfer']>>

export type TransferFromTransaction = EthereumTransaction<Parameters<ERC6160Ext20Abi['functions']['transferFrom']>>

