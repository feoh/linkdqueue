import 'dart:async';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';
import 'package:shared_preferences/shared_preferences.dart';

part 'settings_provider.g.dart';

class AppSettings {
  final String? baseUrl;
  final String? apiToken;

  const AppSettings({this.baseUrl, this.apiToken});

  bool get isConfigured =>
      baseUrl != null &&
      baseUrl!.isNotEmpty &&
      apiToken != null &&
      apiToken!.isNotEmpty;
}

@Riverpod(keepAlive: true)
class SettingsNotifier extends _$SettingsNotifier {
  static const _tokenKey = 'linkding_api_token';
  static const _urlKey = 'linkding_base_url';

  FlutterSecureStorage get _secureStorage => const FlutterSecureStorage();

  @override
  FutureOr<AppSettings> build() async {
    final prefs = await SharedPreferences.getInstance();
    final url = prefs.getString(_urlKey);
    final token = await _secureStorage.read(key: _tokenKey);
    return AppSettings(baseUrl: url, apiToken: token);
  }

  Future<void> saveSettings({
    required String baseUrl,
    required String token,
  }) async {
    final normalized = baseUrl.endsWith('/')
        ? baseUrl.substring(0, baseUrl.length - 1)
        : baseUrl;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_urlKey, normalized);
    await _secureStorage.write(key: _tokenKey, value: token);
    state = AsyncData(AppSettings(baseUrl: normalized, apiToken: token));
  }

  Future<void> clearSettings() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_urlKey);
    await _secureStorage.delete(key: _tokenKey);
    state = const AsyncData(AppSettings());
  }
}
