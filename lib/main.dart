import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:receive_sharing_intent/receive_sharing_intent.dart';

import 'app.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ProviderScope(child: LinkdqueueApp()));
}

/// Returns a stream of shared URLs on mobile, empty on desktop.
Stream<String?> sharedUrlStream() {
  if (!Platform.isAndroid && !Platform.isIOS) {
    return const Stream.empty();
  }
  return ReceiveSharingIntent.instance
      .getMediaStream()
      .map((files) => files.firstOrNull?.path);
}
