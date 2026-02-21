import 'dart:async';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';
import 'package:shared_preferences/shared_preferences.dart';

part 'settings_provider.g.dart';

class AppSettings {
  final String? baseUrl;
  final String? apiToken;
  final double textScale;

  const AppSettings({
    this.baseUrl,
    this.apiToken,
    this.textScale = 1.0,
  });

  bool get isConfigured =>
      baseUrl != null &&
      baseUrl!.isNotEmpty &&
      apiToken != null &&
      apiToken!.isNotEmpty;

  AppSettings copyWith({
    String? baseUrl,
    String? apiToken,
    double? textScale,
  }) {
    return AppSettings(
      baseUrl: baseUrl ?? this.baseUrl,
      apiToken: apiToken ?? this.apiToken,
      textScale: textScale ?? this.textScale,
    );
  }
}

@Riverpod(keepAlive: true)
class SettingsNotifier extends _$SettingsNotifier {
  static const _tokenKey = 'linkding_api_token';
  static const _urlKey = 'linkding_base_url';
  static const _textScaleKey = 'text_scale';

  FlutterSecureStorage get _secureStorage => const FlutterSecureStorage();

  @override
  FutureOr<AppSettings> build() async {
    final prefs = await SharedPreferences.getInstance();
    final url = prefs.getString(_urlKey);
    final token = await _secureStorage.read(key: _tokenKey);
    final textScale = prefs.getDouble(_textScaleKey) ?? 1.0;
    return AppSettings(baseUrl: url, apiToken: token, textScale: textScale);
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
    final current = state.valueOrNull;
    state = AsyncData(AppSettings(
      baseUrl: normalized,
      apiToken: token,
      textScale: current?.textScale ?? 1.0,
    ));
  }

  Future<void> setTextScale(double scale) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setDouble(_textScaleKey, scale);
    final current = state.valueOrNull;
    state = AsyncData(current?.copyWith(textScale: scale) ??
        AppSettings(textScale: scale));
  }

  Future<void> clearSettings() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_urlKey);
    await _secureStorage.delete(key: _tokenKey);
    final current = state.valueOrNull;
    state = AsyncData(AppSettings(textScale: current?.textScale ?? 1.0));
  }
}
