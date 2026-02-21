import 'package:dio/dio.dart';

import '../models/bookmark.dart';
import '../models/paginated_response.dart';
import '../models/tag.dart';
import 'api_exception.dart';

class LinkdingApiClient {
  final Dio _dio;

  LinkdingApiClient({required String baseUrl, required String token})
      : _dio = _buildDio(baseUrl, token);

  static Dio _buildDio(String baseUrl, String token) {
    final dio = Dio(
      BaseOptions(
        baseUrl: baseUrl.endsWith('/') ? baseUrl : '$baseUrl/',
        connectTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(seconds: 30),
        headers: {
          if (token.isNotEmpty) 'Authorization': 'Token $token',
          'Content-Type': 'application/json',
        },
      ),
    );
    dio.interceptors.add(_ErrorInterceptor());
    return dio;
  }

  // Connection test
  Future<void> testConnection() async {
    await _dio.get('api/user/profile/');
  }

  // Bookmarks
  Future<PaginatedResponse<Bookmark>> getBookmarks({
    String? query,
    String? tag,
    bool? isArchived,
    bool? isRead,
    int limit = 20,
    int offset = 0,
  }) async {
    final response = await _dio.get(
      'api/bookmarks/',
      queryParameters: {
        if (query != null && query.isNotEmpty) 'q': query,
        if (tag != null && tag.isNotEmpty) 'tag': tag,
        if (isArchived != null) 'is_archived': isArchived ? 1 : 0,
        if (isRead != null) 'is_read': isRead ? 1 : 0,
        'limit': limit,
        'offset': offset,
      },
    );
    return PaginatedResponse.fromJson(
      response.data as Map<String, dynamic>,
      Bookmark.fromJson,
    );
  }

  Future<Bookmark> createBookmark({
    required String url,
    String title = '',
    String description = '',
    List<String> tagNames = const [],
    bool isRead = false,
  }) async {
    final response = await _dio.post(
      'api/bookmarks/',
      data: {
        'url': url,
        'title': title,
        'description': description,
        'tag_names': tagNames,
        'is_read': isRead,
      },
    );
    return Bookmark.fromJson(response.data as Map<String, dynamic>);
  }

  Future<Bookmark> updateBookmark(int id, Map<String, dynamic> fields) async {
    final response = await _dio.patch(
      'api/bookmarks/$id/',
      data: fields,
    );
    return Bookmark.fromJson(response.data as Map<String, dynamic>);
  }

  Future<void> markRead(int id) async {
    await _dio.patch('api/bookmarks/$id/', data: {'is_read': true});
  }

  Future<void> archiveBookmark(int id) async {
    await _dio.post('api/bookmarks/$id/archive/');
  }

  Future<void> unarchiveBookmark(int id) async {
    await _dio.post('api/bookmarks/$id/unarchive/');
  }

  Future<void> deleteBookmark(int id) async {
    await _dio.delete('api/bookmarks/$id/');
  }

  // Tags
  Future<PaginatedResponse<Tag>> getTags({
    int limit = 100,
    int offset = 0,
  }) async {
    final response = await _dio.get(
      'api/tags/',
      queryParameters: {'limit': limit, 'offset': offset},
    );
    return PaginatedResponse.fromJson(
      response.data as Map<String, dynamic>,
      Tag.fromJson,
    );
  }
}

class _ErrorInterceptor extends Interceptor {
  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    final apiException = _mapError(err);
    handler.reject(
      DioException(
        requestOptions: err.requestOptions,
        error: apiException,
        response: err.response,
        type: err.type,
      ),
    );
  }

  ApiException _mapError(DioException err) {
    if (err.response?.statusCode == 401) {
      return const AuthException();
    }
    if (err.type == DioExceptionType.connectionTimeout ||
        err.type == DioExceptionType.receiveTimeout ||
        err.type == DioExceptionType.sendTimeout ||
        err.type == DioExceptionType.connectionError) {
      return NetworkException(err.message ?? 'Connection failed');
    }
    if (err.response != null) {
      return ServerException(
        err.response!.statusCode ?? 0,
        err.response!.statusMessage ?? 'Unknown server error',
      );
    }
    return UnknownException(err.message ?? 'Unknown error');
  }
}

extension DioExceptionX on DioException {
  ApiException? get apiException {
    final e = error;
    if (e is ApiException) return e;
    return null;
  }
}
