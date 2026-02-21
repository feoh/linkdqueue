import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:infinite_scroll_pagination/infinite_scroll_pagination.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../core/api/api_exception.dart';
import '../../core/models/bookmark.dart';
import '../../core/providers/api_client_provider.dart';
import '../../core/providers/settings_provider.dart';

part 'queue_notifier.g.dart';

class QueueFilter {
  final String query;
  final String? tag;

  const QueueFilter({this.query = '', this.tag});

  @override
  bool operator ==(Object other) =>
      other is QueueFilter && query == other.query && tag == other.tag;

  @override
  int get hashCode => Object.hash(query, tag);
}

@riverpod
class QueueNotifier extends _$QueueNotifier {
  static const _pageSize = 20;

  late PagingController<int, Bookmark> pagingController;
  QueueFilter _filter = const QueueFilter();

  @override
  QueueFilter build() {
    pagingController = PagingController<int, Bookmark>(firstPageKey: 0);
    pagingController.addPageRequestListener(_fetchPage);

    ref.onDispose(() {
      pagingController.dispose();
    });

    return _filter;
  }

  void _fetchPage(int offset) async {
    final settings = ref.read(settingsNotifierProvider).valueOrNull;
    if (settings == null || !settings.isConfigured) return;
    try {
      final client = ref.read(apiClientProvider);
      final response = await client.getBookmarks(
        query: _filter.query.isNotEmpty ? _filter.query : null,
        tag: _filter.tag,
        isArchived: false,
        isRead: false,
        limit: _pageSize,
        offset: offset,
      );

      final isLast = offset + response.results.length >= response.count;
      if (isLast) {
        pagingController.appendLastPage(response.results);
      } else {
        pagingController.appendPage(
          response.results,
          offset + response.results.length,
        );
      }
    } on DioException catch (e) {
      pagingController.error = e.error is ApiException
          ? e.error
          : UnknownException(e.message ?? 'Unknown error');
    } catch (e) {
      pagingController.error = UnknownException(e.toString());
    }
  }

  void applyFilter(QueueFilter filter) {
    if (_filter == filter) return;
    _filter = filter;
    state = filter;
    pagingController.refresh();
  }

  void refresh() => pagingController.refresh();

  void removeItem(int bookmarkId) {
    final items = pagingController.itemList;
    if (items == null) return;
    pagingController.itemList =
        items.where((b) => b.id != bookmarkId).toList();
  }

  void _updateItem(Bookmark updated) {
    final items = pagingController.itemList;
    if (items == null) return;
    pagingController.itemList =
        items.map((b) => b.id == updated.id ? updated : b).toList();
  }

  Future<void> updateTags(int bookmarkId, List<String> tagNames) async {
    try {
      final client = ref.read(apiClientProvider);
      final updated =
          await client.updateBookmark(bookmarkId, {'tag_names': tagNames});
      _updateItem(updated);
    } catch (e) {
      debugPrint('Error updating tags: $e');
    }
  }

  Future<void> markRead(int bookmarkId) async {
    try {
      final client = ref.read(apiClientProvider);
      await client.markRead(bookmarkId);
      removeItem(bookmarkId);
    } catch (e) {
      debugPrint('Error marking read: $e');
    }
  }

  Future<void> archive(int bookmarkId) async {
    try {
      final client = ref.read(apiClientProvider);
      await client.archiveBookmark(bookmarkId);
      removeItem(bookmarkId);
    } catch (e) {
      debugPrint('Error archiving: $e');
    }
  }

  Future<void> delete(int bookmarkId) async {
    try {
      final client = ref.read(apiClientProvider);
      await client.deleteBookmark(bookmarkId);
      removeItem(bookmarkId);
    } catch (e) {
      debugPrint('Error deleting: $e');
    }
  }
}
