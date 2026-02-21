import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../core/models/bookmark.dart';
import '../../core/providers/api_client_provider.dart';

part 'add_bookmark_notifier.g.dart';

enum AddBookmarkStatus { idle, loading, success, failure }

class AddBookmarkState {
  final AddBookmarkStatus status;
  final String? errorMessage;
  final Bookmark? createdBookmark;

  const AddBookmarkState({
    this.status = AddBookmarkStatus.idle,
    this.errorMessage,
    this.createdBookmark,
  });
}

@riverpod
class AddBookmarkNotifier extends _$AddBookmarkNotifier {
  @override
  AddBookmarkState build() => const AddBookmarkState();

  Future<bool> addBookmark({
    required String url,
    String title = '',
    String description = '',
    List<String> tagNames = const [],
    bool isRead = false,
  }) async {
    state = const AddBookmarkState(status: AddBookmarkStatus.loading);
    try {
      final client = ref.read(apiClientProvider);
      final bookmark = await client.createBookmark(
        url: url,
        title: title,
        description: description,
        tagNames: tagNames,
        isRead: isRead,
      );
      state = AddBookmarkState(
        status: AddBookmarkStatus.success,
        createdBookmark: bookmark,
      );
      return true;
    } catch (e) {
      state = AddBookmarkState(
        status: AddBookmarkStatus.failure,
        errorMessage: e.toString(),
      );
      return false;
    }
  }
}
