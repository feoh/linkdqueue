import 'dart:async';

import 'package:riverpod_annotation/riverpod_annotation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../theme/app_themes.dart';

part 'settings_provider.g.dart';

class AppSettings {
  final String? baseUrl;
  final String? apiToken;
  final double textScale;
  final AppThemeOption appTheme;

  const AppSettings({
    this.baseUrl,
    this.apiToken,
    this.textScale = 1.0,
    this.appTheme = AppThemeOption.system,
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
    AppThemeOption? appTheme,
  }) {
    return AppSettings(
      baseUrl: baseUrl ?? this.baseUrl,
      apiToken: apiToken ?? this.apiToken,
      textScale: textScale ?? this.textScale,
      appTheme: appTheme ?? this.appTheme,
    );
  }
}

@Riverpod(keepAlive: true)
class SettingsNotifier extends _$SettingsNotifier {
  static const _tokenKey = 'linkding_api_token';
  static const _urlKey = 'linkding_base_url';
  static const _textScaleKey = 'text_scale';
  static const _themeKey = 'app_theme';

  @override
  FutureOr<AppSettings> build() async {
    final prefs = await SharedPreferences.getInstance();
    final url = prefs.getString(_urlKey);
    final token = prefs.getString(_tokenKey);
    final textScale = prefs.getDouble(_textScaleKey) ?? 1.0;
    final themeName = prefs.getString(_themeKey);
    final appTheme = themeName != null
        ? AppThemeOption.values.asNameMap()[themeName] ?? AppThemeOption.system
        : AppThemeOption.system;
    return AppSettings(
      baseUrl: url,
      apiToken: token,
      textScale: textScale,
      appTheme: appTheme,
    );
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
    await prefs.setString(_tokenKey, token);
    final current = state.valueOrNull;
    state = AsyncData(AppSettings(
      baseUrl: normalized,
      apiToken: token,
      textScale: current?.textScale ?? 1.0,
      appTheme: current?.appTheme ?? AppThemeOption.system,
    ));
  }

  Future<void> setTextScale(double scale) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setDouble(_textScaleKey, scale);
    state = AsyncData(
      (state.valueOrNull ?? const AppSettings()).copyWith(textScale: scale),
    );
  }

  Future<void> setAppTheme(AppThemeOption theme) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_themeKey, theme.name);
    state = AsyncData(
      (state.valueOrNull ?? const AppSettings()).copyWith(appTheme: theme),
    );
  }

  Future<void> clearSettings() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_urlKey);
    await prefs.remove(_tokenKey);
    final current = state.valueOrNull;
    state = AsyncData(AppSettings(
      textScale: current?.textScale ?? 1.0,
      appTheme: current?.appTheme ?? AppThemeOption.system,
    ));
  }
}
