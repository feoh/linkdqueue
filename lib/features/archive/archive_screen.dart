import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:infinite_scroll_pagination/infinite_scroll_pagination.dart';

import '../../core/api/api_exception.dart';
import '../../core/models/bookmark.dart';
import 'archive_notifier.dart';
import '../queue/widgets/bookmark_list_tile.dart';

class ArchiveScreen extends ConsumerWidget {
  const ArchiveScreen({super.key});

  Future<void> _confirmDelete(
    BuildContext context,
    int bookmarkId,
    ArchiveNotifier notifier,
  ) async {
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
      await notifier.delete(bookmarkId);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notifier = ref.watch(archiveNotifierProvider.notifier);

    return Scaffold(
      appBar: AppBar(title: const Text('Archive')),
      body: RefreshIndicator(
        onRefresh: () async => notifier.refresh(),
        child: PagedListView<int, Bookmark>(
          pagingController: notifier.pagingController,
          builderDelegate: PagedChildBuilderDelegate<Bookmark>(
            itemBuilder: (context, bookmark, index) => Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                BookmarkListTile(
                  bookmark: bookmark,
                  onArchive: () => notifier.unarchive(bookmark.id),
                  onDelete: () =>
                      _confirmDelete(context, bookmark.id, notifier),
                ),
                const Divider(height: 1),
              ],
            ),
            firstPageErrorIndicatorBuilder: (_) => Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.cloud_off_outlined, size: 56),
                    const SizedBox(height: 16),
                    Text(
                      notifier.pagingController.error is ApiException
                          ? notifier.pagingController.error.toString()
                          : 'Failed to load archive',
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
            ),
            noItemsFoundIndicatorBuilder: (_) => const Center(
              child: Padding(
                padding: EdgeInsets.all(48),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.archive_outlined, size: 72),
                    SizedBox(height: 16),
                    Text('Archive is empty'),
                  ],
                ),
              ),
            ),
            firstPageProgressIndicatorBuilder: (_) =>
                const Center(child: CircularProgressIndicator()),
          ),
        ),
      ),
    );
  }
}
