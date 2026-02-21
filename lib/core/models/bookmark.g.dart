// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'bookmark.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Bookmark _$BookmarkFromJson(Map<String, dynamic> json) => Bookmark(
  id: (json['id'] as num).toInt(),
  url: json['url'] as String,
  title: json['title'] as String? ?? '',
  websiteTitle: json['website_title'] as String?,
  websiteDescription: json['website_description'] as String?,
  description: json['description'] as String? ?? '',
  tagNames:
      (json['tag_names'] as List<dynamic>?)?.map((e) => e as String).toList() ??
      [],
  isArchived: json['is_archived'] as bool? ?? false,
  isRead: json['is_read'] as bool? ?? false,
  dateAdded: DateTime.parse(json['date_added'] as String),
);

Map<String, dynamic> _$BookmarkToJson(Bookmark instance) => <String, dynamic>{
  'id': instance.id,
  'url': instance.url,
  'title': instance.title,
  'website_title': instance.websiteTitle,
  'website_description': instance.websiteDescription,
  'description': instance.description,
  'tag_names': instance.tagNames,
  'is_archived': instance.isArchived,
  'is_read': instance.isRead,
  'date_added': instance.dateAdded.toIso8601String(),
};
