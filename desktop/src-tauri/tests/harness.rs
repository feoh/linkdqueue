mod support;

use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;

use support::{Failure, FakeKeyring, MockHttpServer, TempPrefs};

#[test]
fn fake_keyring_and_preferences_are_isolated() {
    let prefs = TempPrefs::new();
    let path = prefs.path().join("preferences.json");
    fs::write(&path, br#"{"schemaVersion":1,"connectionState":"disconnected"}"#)
        .expect("write test preferences");

    let mut keyring = FakeKeyring::default();
    keyring
        .set("fixture-reference", "fixture-value")
        .expect("write fake credential");
    assert_eq!(
        keyring
            .get("fixture-reference")
            .expect("read fake credential")
            .as_deref(),
        Some("fixture-value")
    );

    keyring.set_failure(Some(Failure::Delete));
    assert_eq!(keyring.delete("fixture-reference"), Err(Failure::Delete));
    assert!(path.exists());
}

#[test]
fn loopback_http_fixture_is_the_only_network_harness() {
    let server = MockHttpServer::start();
    let mut stream = TcpStream::connect(server.address()).expect("connect fixture server");
    stream
        .write_all(b"GET /api/user/profile/ HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
        .expect("send fixture request");
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .expect("read fixture response");

    assert!(response.starts_with("HTTP/1.1 200 OK"));
    assert!(response.contains(r#""theme":"auto""#));
}
