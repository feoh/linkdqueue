sealed class ApiException implements Exception {
  const ApiException();
}

class AuthException extends ApiException {
  const AuthException();

  @override
  String toString() => 'Invalid or expired API token. Please update your settings.';
}

class NetworkException extends ApiException {
  final String message;

  const NetworkException(this.message);

  @override
  String toString() => 'Network error: $message';
}

class ServerException extends ApiException {
  final int statusCode;
  final String message;

  const ServerException(this.statusCode, this.message);

  @override
  String toString() => 'Server error $statusCode: $message';
}

class UnknownException extends ApiException {
  final String message;

  const UnknownException(this.message);

  @override
  String toString() => 'Unknown error: $message';
}
