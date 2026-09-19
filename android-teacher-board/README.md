# Teacher PDF Board — Native Android preview

This project is intentionally separate from the live academy PWA.

The first preview validates the part that was not reliable in the browser:

- Android `PdfRenderer`, not PDF.js or an HTML canvas renderer.
- Continuous vertical pages with the previous/current/next pages retained.
- Rendering on a dedicated worker thread so toolbar controls stay responsive.
- Native pinch zoom, drag, fling and double-tap zoom.
- Bounded bitmap memory for 200–500 page books.
- The source PDF is opened read-only and is never converted or modified.

Ink, eraser, saved annotations, groups and participation points will be added
after this viewer is verified on the Hikvision screen.

## Build

```bash
gradle -p android-teacher-board assembleDebug
```

The debug APK is written to:

`android-teacher-board/app/build/outputs/apk/debug/app-debug.apk`
