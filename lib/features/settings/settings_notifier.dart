import 'package:dio/dio.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../core/api/api_exception.dart';
import '../../core/api/linkding_api_client.dart';

part 'settings_notifier.g.dart';

enum ConnectionTestState { idle, loading, success, failure }

class ConnectionTestResult {
  final ConnectionTestState state;
  final String? errorMessage;

  const ConnectionTestResult({
    required this.state,
    this.errorMessage,
  });

  static const idle = ConnectionTestResult(state: ConnectionTestState.idle);
  static const loading =
      ConnectionTestResult(state: ConnectionTestState.loading);
  static const success =
      ConnectionTestResult(state: ConnectionTestState.success);
}

@riverpod
class ConnectionTester extends _$ConnectionTester {
  @override
  ConnectionTestResult build() => ConnectionTestResult.idle;

  Future<bool> test({
    required String baseUrl,
    required String token,
  }) async {
    state = ConnectionTestResult.loading;
    try {
      final client = LinkdingApiClient(baseUrl: baseUrl, token: token);
      await client.testConnection();
      state = ConnectionTestResult.success;
      return true;
    } on DioException catch (e) {
      final msg = (e.error is ApiException)
          ? e.error.toString()
          : (e.message ?? 'Connection failed');
      state = ConnectionTestResult(
        state: ConnectionTestState.failure,
        errorMessage: msg,
      );
      return false;
    } catch (e) {
      state = ConnectionTestResult(
        state: ConnectionTestState.failure,
        errorMessage: e.toString(),
      );
      return false;
    }
  }

  void reset() => state = ConnectionTestResult.idle;
}
