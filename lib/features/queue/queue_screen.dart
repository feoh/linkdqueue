import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:infinite_scroll_pagination/infinite_scroll_pagination.dart';

import '../../core/api/api_exception.dart';
import '../../core/models/bookmark.dart';
import '../tags/tags_notifier.dart';
import 'queue_notifier.dart';
import 'widgets/bookmark_filter_bar.dart';
import 'widgets/bookmark_list_tile.dart';
import 'widgets/tag_editor_sheet.dart';

class QueueScreen extends ConsumerStatefulWidget {
  const QueueScreen({super.key});

  @override
  ConsumerState<QueueScreen> createState() => _QueueScreenState();
}

class _QueueScreenState extends ConsumerState<QueueScreen> {
  String _searchQuery = '';
  String? _selectedTag;
  bool _initialFilterApplied = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_initialFilterApplied) {
      _initialFilterApplied = true;
      final routeTag =
          GoRouterState.of(context).uri.queryParameters['tag'];
      if (routeTag != null) {
        _selectedTag = routeTag;
        WidgetsBinding.instance
            .addPostFrameCallback((_) => _applyFilter());
      }
    }
  }

  void _applyFilter() {
    ref.read(queueNotifierProvider.notifier).applyFilter(
          QueueFilter(
            query: _searchQuery,
            tag: _selectedTag,
          ),
        );
  }

  Future<void> _openTagEditor(
      Bookmark bookmark, List<String> availableTags) async {
    final notifier = ref.read(queueNotifierProvider.notifier);
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => TagEditorSheet(
        bookmark: bookmark,
        availableTags: availableTags,
        onSave: (newTags) => notifier.updateTags(bookmark.id, newTags),
      ),
    );
  }

  Future<void> _confirmDelete(int bookmarkId) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete bookmark?'),
        content: const Text('This cannot be undone.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error,
            ),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await ref.read(queueNotifierProvider.notifier).delete(bookmarkId);
    }
  }

  @override
  Widget build(BuildContext context) {
    final notifier = ref.watch(queueNotifierProvider.notifier);
    final tagsAsync = ref.watch(tagsNotifierProvider);
    final tagsList =
        tagsAsync.valueOrNull?.map((t) => t.name).toList() ?? [];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Reading Queue'),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings_outlined),
            onPressed: () => context.go('/settings'),
          ),
          IconButton(
            icon: const Icon(Icons.add),
            onPressed: () => context.push('/add'),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async => notifier.refresh(),
        child: CustomScrollView(
          slivers: [
            SliverToBoxAdapter(
              child: BookmarkFilterBar(
                availableTags: tagsList,
                tagsLoading: tagsAsync.isLoading,
                selectedTag: _selectedTag,
                searchQuery: _searchQuery,
                onQueryChanged: (q) {
                  setState(() => _searchQuery = q);
                  _applyFilter();
                },
                onTagChanged: (t) {
                  setState(() => _selectedTag = t);
                  _applyFilter();
                },
              ),
            ),
            PagedSliverList<int, Bookmark>(
              pagingController: notifier.pagingController,
              builderDelegate: PagedChildBuilderDelegate<Bookmark>(
                itemBuilder: (context, bookmark, index) => Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    BookmarkListTile(
                      bookmark: bookmark,
                      onMarkRead: () => notifier.markRead(bookmark.id),
                      onArchive: () => notifier.archive(bookmark.id),
                      onDelete: () => _confirmDelete(bookmark.id),
                      onEditTags: () => _openTagEditor(bookmark, tagsList),
                      selectedTag: _selectedTag,
                      onTagTapped: (tag) {
                        // Tap active tag → clear; tap new tag → filter
                        setState(() {
                          _selectedTag = _selectedTag == tag ? null : tag;
                        });
                        _applyFilter();
                      },
                    ),
                    const Divider(height: 1),
                  ],
                ),
                firstPageErrorIndicatorBuilder: (_) =>
                    _ErrorView(notifier: notifier),
                newPageErrorIndicatorBuilder: (_) =>
                    _ErrorView(notifier: notifier),
                noItemsFoundIndicatorBuilder: (_) => const _EmptyView(),
                firstPageProgressIndicatorBuilder: (_) =>
                    const Center(child: CircularProgressIndicator()),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  final QueueNotifier notifier;

  const _ErrorView({required this.notifier});

  @override
  Widget build(BuildContext context) {
    final error = notifier.pagingController.error;
    String message = 'Something went wrong';
    if (error is ApiException) message = error.toString();

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.cloud_off_outlined,
              size: 56,
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
            const SizedBox(height: 16),
            Text(
              message,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyLarge,
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: notifier.refresh,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyView extends StatelessWidget {
  const _EmptyView();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(48),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.done_all,
              size: 72,
              color: Theme.of(context).colorScheme.primary,
            ),
            const SizedBox(height: 16),
            Text(
              'All caught up!',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 8),
            Text(
              'No unread bookmarks in your queue.',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
            ),
          ],
        ),
      ),
    );
  }
}
