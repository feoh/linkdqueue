import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/providers/settings_provider.dart';
import 'core/router/app_router.dart';

class LinkdqueueApp extends ConsumerWidget {
  const LinkdqueueApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(appRouterProvider);
    final textScale =
        ref.watch(settingsNotifierProvider).valueOrNull?.textScale ?? 1.0;

    return MaterialApp.router(
      title: 'Linkdqueue',
      routerConfig: router,
      theme: ThemeData(
        colorSchemeSeed: const Color(0xFF4A90D9),
        brightness: Brightness.light,
        useMaterial3: true,
      ),
      darkTheme: ThemeData(
        colorSchemeSeed: const Color(0xFF4A90D9),
        brightness: Brightness.dark,
        useMaterial3: true,
      ),
      themeMode: ThemeMode.system,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: TextScaler.linear(textScale),
        ),
        child: child!,
      ),
    );
  }
}
