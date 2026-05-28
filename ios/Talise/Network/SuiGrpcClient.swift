// SuiGrpcClient.swift
//
// Skeleton for the Sui fullnode gRPC client. This file establishes
// the singleton + import surface so the generated stubs under
// ios/Talise/Network/SuiProto/Generated/ are referenced and the
// project compiles against grpc-swift v2.
//
// The four method bodies are intentionally fatalError() stubs — they
// are filled in by sub-plans 3.4–3.7. Do not implement them here.
//
// grpc-swift v2 APIs are only available on iOS 18+ / macOS 15+, so
// this whole type is gated behind that availability. Sub-plan 3.8
// wires it into ZkLoginCoordinator behind an `if #available` check
// (the app's deployment target is iOS 17.0).

import Foundation
import GRPCCore
import GRPCNIOTransportHTTP2Posix
import GRPCProtobuf
import SwiftProtobuf

@available(iOS 18.0, macOS 15.0, *)
@MainActor
final class SuiGrpcClient {
    static let shared = SuiGrpcClient(baseUrl: "https://fullnode.mainnet.sui.io:443")

    private let baseUrl: String

    // Channel/transport state lives here once sub-plans 3.4–3.7 build
    // it out — likely a long-lived `GRPCClient<HTTP2ClientTransport.Posix>`
    // launched in a Task at first use and re-used for the app's lifetime.

    private init(baseUrl: String) {
        self.baseUrl = baseUrl
    }

    // MARK: - Method stubs (filled in by sub-plans 3.4–3.7)

    /// Returns the current epoch summary from `LedgerService.GetEpoch`.
    /// Implemented by sub-plan 3.4.
    func getLatestEpoch() async throws -> Sui_Rpc_V2_Epoch {
        fatalError("SuiGrpcClient.getLatestEpoch not yet implemented (sub-plan 3.4)")
    }

    /// Returns the current reference gas price from the latest epoch.
    /// Implemented by sub-plan 3.5.
    func getReferenceGasPrice() async throws -> UInt64 {
        fatalError("SuiGrpcClient.getReferenceGasPrice not yet implemented (sub-plan 3.5)")
    }

    /// Returns the balance of `coinType` owned by `address` from
    /// `StateService.GetBalance`. Implemented by sub-plan 3.6.
    func getBalance(address: String, coinType: String) async throws -> Sui_Rpc_V2_Balance {
        fatalError("SuiGrpcClient.getBalance not yet implemented (sub-plan 3.6)")
    }

    /// Submits a signed transaction via
    /// `TransactionExecutionService.ExecuteTransaction`.
    /// Implemented by sub-plan 3.7.
    func executeTransaction(
        transactionBcs: Data,
        signatures: [Data]
    ) async throws -> Sui_Rpc_V2_ExecuteTransactionResponse {
        fatalError("SuiGrpcClient.executeTransaction not yet implemented (sub-plan 3.7)")
    }
}
