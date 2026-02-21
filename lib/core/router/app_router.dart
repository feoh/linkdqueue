import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../features/add_bookmark/add_bookmark_screen.dart';
import '../../features/archive/archive_screen.dart';
import '../../features/queue/queue_screen.dart';
import '../../features/settings/settings_screen.dart';
import '../../features/tags/tags_screen.dart';
import '../providers/settings_provider.dart';
import 'app_shell.dart';

part 'app_router.g.dart';

@Riverpod(keepAlive: true)
GoRouter appRouter(Ref ref) {
  final settingsAsync = ref.watch(settingsNotifierProvider);

  return GoRouter(
    initialLocation: '/queue',
    redirect: (context, state) {
      final configured = settingsAsync.when(
        data: (s) => s.isConfigured,
        loading: () => true, // don't redirect while loading
        error: (_, _) => false,
      );

      final onSettings = state.matchedLocation.startsWith('/settings');
      if (!configured && !onSettings) return '/settings';
      if (configured && onSettings && state.matchedLocation == '/settings' && !settingsAsync.isLoading) {
        return null; // let user edit settings
      }
      return null;
    },
    routes: [
      GoRoute(
        path: '/settings',
        builder: (context, state) => const SettingsScreen(),
      ),
      ShellRoute(
        builder: (context, state, child) => AppShell(child: child),
        routes: [
          GoRoute(
            path: '/queue',
            builder: (context, state) => const QueueScreen(),
          ),
          GoRoute(
            path: '/archive',
            builder: (context, state) => const ArchiveScreen(),
          ),
          GoRoute(
            path: '/tags',
            builder: (context, state) => const TagsScreen(),
          ),
        ],
      ),
      GoRoute(
        path: '/add',
        builder: (context, state) {
          final url = state.uri.queryParameters['url'];
          return AddBookmarkScreen(initialUrl: url);
        },
      ),
    ],
  );
}
