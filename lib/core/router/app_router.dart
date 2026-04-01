import 'package:flutter/foundation.dart';
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

/// A [ChangeNotifier] that fires whenever [settingsNotifierProvider] changes.
/// Used as [GoRouter.refreshListenable] so the router re-runs redirect logic
/// without being recreated (which would destroy the navigation stack).
class _SettingsListenable extends ChangeNotifier {
  final ProviderSubscription<AsyncValue<AppSettings>> _sub;

  _SettingsListenable(Ref ref)
      : _sub = ref.listen(
          settingsNotifierProvider,
          (prev, next) {},
          fireImmediately: false,
        ) {
    ref.listen(settingsNotifierProvider, (prev, next) => notifyListeners());
  }

  @override
  void dispose() {
    _sub.close();
    super.dispose();
  }
}

@Riverpod(keepAlive: true)
GoRouter appRouter(Ref ref) {
  final listenable = _SettingsListenable(ref);
  ref.onDispose(listenable.dispose);

  return GoRouter(
    initialLocation: '/queue',
    refreshListenable: listenable,
    redirect: (context, state) {
      final settingsAsync = ref.read(settingsNotifierProvider);
      final configured = settingsAsync.when(
        data: (s) => s.isConfigured,
        loading: () => true, // don't redirect while loading
        error: (_, _) => false,
      );

      final onSettings = state.matchedLocation.startsWith('/settings');
      if (!configured && !onSettings) return '/settings';
      if (configured && onSettings &&
          state.matchedLocation == '/settings' &&
          !settingsAsync.isLoading) {
        return '/queue';
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
