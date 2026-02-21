import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/providers/settings_provider.dart';
import 'core/router/app_router.dart';
import 'core/theme/app_themes.dart';

class LinkdqueueApp extends ConsumerWidget {
  const LinkdqueueApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(appRouterProvider);
    final settings = ref.watch(settingsNotifierProvider).valueOrNull;
    final textScale = settings?.textScale ?? 1.0;
    final themeOption = settings?.appTheme ?? AppThemeOption.system;

    final Widget app;
    if (themeOption == AppThemeOption.system) {
      app = MaterialApp.router(
        title: 'Linkdqueue',
        routerConfig: router,
        theme: AppThemes.systemLight,
        darkTheme: AppThemes.systemDark,
        themeMode: ThemeMode.system,
        builder: (context, child) => _textScaleWrapper(context, child, textScale),
      );
    } else {
      final themeData = AppThemes.build(themeOption);
      app = MaterialApp.router(
        title: 'Linkdqueue',
        routerConfig: router,
        theme: themeData,
        themeMode: ThemeMode.light, // brightness is baked into the ColorScheme
        builder: (context, child) => _textScaleWrapper(context, child, textScale),
      );
    }
    return app;
  }

  static Widget _textScaleWrapper(
      BuildContext context, Widget? child, double scale) {
    return MediaQuery(
      data: MediaQuery.of(context).copyWith(
        textScaler: TextScaler.linear(scale),
      ),
      child: child!,
    );
  }
}
