import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:linkdqueue/app.dart';

void main() {
  testWidgets('App smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(const ProviderScope(child: LinkdqueueApp()));
    // Settings screen should appear for unconfigured state
    await tester.pumpAndSettle();
  });
}
