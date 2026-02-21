import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../api/linkding_api_client.dart';
import 'settings_provider.dart';

part 'api_client_provider.g.dart';

@Riverpod(keepAlive: true)
LinkdingApiClient apiClient(Ref ref) {
  final settings = ref.watch(settingsNotifierProvider);
  return settings.when(
    data: (s) => LinkdingApiClient(
      baseUrl: s.baseUrl ?? '',
      token: s.apiToken ?? '',
    ),
    loading: () => LinkdingApiClient(baseUrl: '', token: ''),
    error: (_, _) => LinkdingApiClient(baseUrl: '', token: ''),
  );
}
