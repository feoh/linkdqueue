import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:infinite_scroll_pagination/infinite_scroll_pagination.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../core/api/api_exception.dart';
import '../../core/models/bookmark.dart';
import '../../core/providers/api_client_provider.dart';

part 'archive_notifier.g.dart';

@riverpod
class ArchiveNotifier extends _$ArchiveNotifier {
  static const _pageSize = 20;

  late PagingController<int, Bookmark> pagingController;

  @override
  void build() {
    pagingController = PagingController<int, Bookmark>(firstPageKey: 0);
    pagingController.addPageRequestListener(_fetchPage);

    ref.onDispose(() {
      pagingController.dispose();
    });
  }

  void _fetchPage(int offset) async {
    try {
      final client = ref.read(apiClientProvider);
      final response = await client.getBookmarks(
        isArchived: true,
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

  void refresh() => pagingController.refresh();

  void removeItem(int bookmarkId) {
    final items = pagingController.itemList;
    if (items == null) return;
    pagingController.itemList =
        items.where((b) => b.id != bookmarkId).toList();
  }

  Future<void> unarchive(int bookmarkId) async {
    try {
      final client = ref.read(apiClientProvider);
      await client.unarchiveBookmark(bookmarkId);
      removeItem(bookmarkId);
    } catch (e) {
      debugPrint('Error unarchiving: $e');
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
