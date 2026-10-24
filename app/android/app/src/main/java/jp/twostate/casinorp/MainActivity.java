package jp.twostate.casinorp;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.graphics.Color;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * The whole app: the online game (BuildConfig.APP_URL) in a full-screen,
 * landscape WebView, with the microphone for voice chat, the back button
 * wired to the game, and updates of the app itself (download + install from
 * inside the app when the game's site offers a newer version), and the
 * phone's notifications for messages, calls and invitations while the app
 * is in the background (the page asks through the bridge: js/net/push.js).
 */
public class MainActivity extends Activity {
    private static final int REQ_MIC = 1;
    private static final int REQ_NOTIFY = 2;
    private static final String EXTRA_OPEN = "jp.twostate.casinorp.OPEN";
    private static final String CH_MESSAGES = "messages";
    private static final String CH_CALLS = "calls";
    private static final String ACTION_INSTALL_STATUS = "jp.twostate.casinorp.INSTALL_STATUS";
    private static final String EXTRA_TOKEN = "jp.twostate.casinorp.TOKEN";
    private static final String OFFLINE_PAGE = "file:///android_asset/offline.html";

    private WebView web;
    private FrameLayout root;
    private Uri home;
    private PermissionRequest pendingMic;
    private File pendingApk;          // downloaded, waiting for "install unknown apps"
    private boolean updating;
    private boolean clearHistory;
    // the activity is exported (it is the launcher): only install results carrying this token are ours
    private final String installToken = java.util.UUID.randomUUID().toString();

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        home = Uri.parse(BuildConfig.APP_URL);
        Window w = getWindow();
        w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = w.getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            w.setAttributes(lp);
        }
        setVolumeControlStream(AudioManager.STREAM_MUSIC);
        makeChannels();

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        if (Build.VERSION.SDK_INT >= 30) {
            // draw behind the hidden bars; only the keyboard takes space away
            w.setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                v.setPadding(0, 0, 0, insets.getInsets(WindowInsets.Type.ime()).bottom);
                return insets;
            });
        }
        hideBars();
        configure(web);
        // opened from a notification: the game opens where it leads
        String open = openOf(getIntent());
        if (state == null || web.restoreState(state) == null) {
            web.loadUrl(open == null ? BuildConfig.APP_URL : BuildConfig.APP_URL + "?open=" + Uri.encode(open));
            if (open == null) handleIntent(getIntent());
        } else {
            handleIntent(getIntent());
        }
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void configure(WebView v) {
        WebSettings s = v.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setSupportMultipleWindows(false);
        // the game has its own layout units: the system font size must not scale it
        s.setTextZoom(100);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setUserAgentString(s.getUserAgentString() + " TwoStateCasinoApp/" + BuildConfig.VERSION_NAME);
        v.setOverScrollMode(View.OVER_SCROLL_NEVER);
        v.setWebViewClient(new Client());
        v.setWebChromeClient(new Chrome());
        v.addJavascriptInterface(new Bridge(), "TwoStateApp");
        v.setDownloadListener((url, ua, disposition, mime, length) -> openOutside(Uri.parse(url)));
    }

    /* ------------------------------------------------------------ screen --- */

    @SuppressWarnings("deprecation")
    private void hideBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideBars();
    }

    /* ------------------------------------------------------------ pages --- */

    private boolean isHome(Uri u) {
        if (u == null) return false;
        if (u.toString().startsWith(OFFLINE_PAGE)) return true;
        return home.getScheme() != null && home.getScheme().equals(u.getScheme())
                && home.getHost() != null && home.getHost().equalsIgnoreCase(u.getHost())
                && home.getPort() == u.getPort();
    }

    private void openOutside(Uri u) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (ActivityNotFoundException e) {
            // nothing can open it
        }
    }

    private void showOffline() {
        web.loadUrl(OFFLINE_PAGE);
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
            Uri u = r.getUrl();
            if (isHome(u) && !u.getPath().endsWith(".apk")) return false;
            openOutside(u);
            return true;
        }

        @Override
        public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
            if (r.isForMainFrame()) showOffline();
        }

        @Override
        public void onPageFinished(WebView v, String url) {
            if (clearHistory && !url.startsWith(OFFLINE_PAGE)) {
                clearHistory = false;
                v.clearHistory();
            }
        }

        @Override
        public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail detail) {
            // the page crashed: start over instead of taking the app down
            recreate();
            return true;
        }
    }

    private class Chrome extends WebChromeClient {
        @Override
        public void onPermissionRequest(PermissionRequest req) {
            runOnUiThread(() -> {
                boolean mic = false;
                for (String res : req.getResources()) {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)) mic = true;
                }
                if (!mic || !isHome(req.getOrigin())) {
                    req.deny();
                    return;
                }
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    req.grant(new String[] {PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                } else {
                    if (pendingMic != null) pendingMic.deny();
                    pendingMic = req;
                    requestPermissions(new String[] {Manifest.permission.RECORD_AUDIO}, REQ_MIC);
                }
            });
        }

        @Override
        public void onPermissionRequestCanceled(PermissionRequest req) {
            if (pendingMic == req) pendingMic = null;
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == REQ_NOTIFY) {
            tellNotifyState();
            return;
        }
        if (code != REQ_MIC || pendingMic == null) return;
        PermissionRequest req = pendingMic;
        pendingMic = null;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
            req.grant(new String[] {PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        } else {
            req.deny();
        }
    }

    /* ------------------------------------------------------------ back button --- */

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        String url = web.getUrl();
        if (url != null && url.startsWith(OFFLINE_PAGE)) {
            moveTaskToBack(true);
            return;
        }
        // the game steps back itself (dialogs, tabs, screens); on its start screen the app goes away
        web.evaluateJavascript("(function(){try{return !!(window.BRNative&&BRNative.back());}catch(e){return false;}})()",
                value -> {
                    if (!"true".equals(value)) moveTaskToBack(true);
                });
    }

    /* ------------------------------------------------------------ the page's bridge --- */

    private class Bridge {
        /** Explicit player exit; close the game task rather than navigating back. */
        @JavascriptInterface
        public void exit() {
            runOnUiThread(() -> finishAndRemoveTask());
        }

        @JavascriptInterface
        public int versionCode() {
            return BuildConfig.VERSION_CODE;
        }

        @JavascriptInterface
        public String versionName() {
            return BuildConfig.VERSION_NAME;
        }

        /** SHA-256 of this app's signing certificate (hex). */
        @JavascriptInterface
        public String signature() {
            byte[] cert = installedCert();
            return cert == null ? "" : sha256Hex(cert);
        }

        /** Downloads the newer app from the game's own site and installs it. */
        @JavascriptInterface
        public void update(String apkUrl, String sha256) {
            runOnUiThread(() -> startUpdate(apkUrl, sha256));
        }

        /** "granted", "denied" or "default" (not asked yet, or turned off in the game). */
        @JavascriptInterface
        public String notifyState() {
            return notifyStateNow();
        }

        /** The player wants notifications: the system asks for the permission if it has to. */
        @JavascriptInterface
        public void askNotify() {
            runOnUiThread(() -> {
                prefs().edit().putBoolean("notify_off", false).apply();
                if (Build.VERSION.SDK_INT >= 33
                        && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    prefs().edit().putBoolean("notify_asked", true).apply();
                    requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFY);
                } else {
                    tellNotifyState();
                }
            });
        }

        /** Turned off in the game. */
        @JavascriptInterface
        public void notifyOff() {
            prefs().edit().putBoolean("notify_off", true).apply();
        }

        /** A message, a call or an invitation while the app is in the background. */
        @JavascriptInterface
        public void notice(String title, String body, String tag, int call, String open) {
            runOnUiThread(() -> showNotification(title, body, tag, call != 0, open));
        }

        /** The "try again" button of the offline page. */
        @JavascriptInterface
        public void retry() {
            runOnUiThread(() -> {
                clearHistory = true;
                web.loadUrl(BuildConfig.APP_URL);
            });
        }
    }

    /** Tells the page how the update is going: { state, progress?, message? }. */
    private void updateEvent(String state, int progress, String message) {
        JSONObject o = new JSONObject();
        try {
            o.put("state", state);
            if (progress >= 0) o.put("progress", progress);
            if (message != null) o.put("message", message);
        } catch (JSONException e) {
            return;
        }
        String js = "window.BRNative&&BRNative.updateEvent&&BRNative.updateEvent(" + o + ")";
        runOnUiThread(() -> web.evaluateJavascript(js, null));
    }

    /* ------------------------------------------------------------ updating the app --- */

    private void startUpdate(String apkUrl, String sha256) {
        if (updating) return;
        Uri u;
        try {
            u = Uri.parse(URI.create(BuildConfig.APP_URL).resolve(apkUrl).toString());
        } catch (IllegalArgumentException e) {
            u = null;
        }
        // only ever from the game's own site (same scheme and host)
        if (!isHome(u) || u.toString().startsWith(OFFLINE_PAGE)) {
            updateEvent("error", -1, "アップデートの場所が正しくありません");
            return;
        }
        updating = true;
        updateEvent("downloading", 0, null);
        final String target = u.toString();
        new Thread(() -> {
            try {
                File apk = download(target, sha256);
                runOnUiThread(() -> installWhenAllowed(apk));
            } catch (IOException e) {
                updating = false;
                updateEvent("error", -1, e.getMessage());
            }
        }, "app-update").start();
    }

    private File download(String url, String sha256) throws IOException {
        File out = new File(getCacheDir(), "update.apk");
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        c.setRequestProperty("Cache-Control", "no-cache");
        try {
            if (c.getResponseCode() != 200) throw new IOException("ダウンロードできませんでした（" + c.getResponseCode() + "）");
            long total = c.getContentLengthLong();
            MessageDigest md = sha256();
            try (InputStream in = c.getInputStream(); OutputStream os = new FileOutputStream(out)) {
                byte[] buf = new byte[65536];
                long done = 0;
                int last = -1, n;
                while ((n = in.read(buf)) > 0) {
                    os.write(buf, 0, n);
                    md.update(buf, 0, n);
                    done += n;
                    int p = total > 0 ? (int) (done * 100 / total) : -1;
                    if (p != last && p >= 0) {
                        last = p;
                        updateEvent("downloading", p, null);
                    }
                }
            }
            if (sha256 != null && !sha256.isEmpty() && !toHex(md.digest()).equalsIgnoreCase(sha256)) {
                throw new IOException("ダウンロードしたファイルが壊れています。もう一度お試しください");
            }
            return out;
        } catch (IOException e) {
            if (e.getMessage() == null) throw new IOException("ダウンロードできませんでした", e);
            throw e;
        } finally {
            c.disconnect();
        }
    }

    private void installWhenAllowed(File apk) {
        String problem = checkArchive(apk);
        if (problem != null) {
            updating = false;
            updateEvent("error", -1, problem);
            return;
        }
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            // Android asks once: allow this app to install its own updates
            pendingApk = apk;
            updateEvent("permission", -1, null);
            try {
                startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName())));
            } catch (ActivityNotFoundException e) {
                updating = false;
                pendingApk = null;
                updateEvent("error", -1, "設定画面を開けませんでした");
            }
            return;
        }
        install(apk);
    }

    /** null when the file is a newer version of this very app, signed by the same key. */
    @SuppressWarnings("deprecation")
    private String checkArchive(File apk) {
        PackageManager pm = getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo info = pm.getPackageArchiveInfo(apk.getPath(), flags);
        if (info == null || !getPackageName().equals(info.packageName)) return "このアプリのアップデートではありません";
        if (info.versionCode <= BuildConfig.VERSION_CODE) return "すでに最新のバージョンです";
        byte[] mine = installedCert();
        byte[] theirs = null;
        if (Build.VERSION.SDK_INT >= 28 && info.signingInfo != null) {
            Signature[] s = info.signingInfo.getApkContentsSigners();
            if (s != null && s.length > 0) theirs = s[0].toByteArray();
        } else if (info.signatures != null && info.signatures.length > 0) {
            theirs = info.signatures[0].toByteArray();
        }
        if (mine != null && theirs != null && !MessageDigest.isEqual(mine, theirs)) {
            return "署名が違うため、このアプリの上に入れられません。いったんアプリを削除してから新しいアプリを入れてください（残高などはサーバーに保存されています）";
        }
        return null;
    }

    private void install(File apk) {
        try {
            PackageInstaller installer = getPackageManager().getPackageInstaller();
            PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            params.setAppPackageName(getPackageName());
            if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
            int id = installer.createSession(params);
            try (PackageInstaller.Session session = installer.openSession(id)) {
                try (InputStream in = new FileInputStream(apk); OutputStream out = session.openWrite("base.apk", 0, apk.length())) {
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    session.fsync(out);
                }
                Intent status = new Intent(this, MainActivity.class).setAction(ACTION_INSTALL_STATUS)
                        .putExtra(EXTRA_TOKEN, installToken);
                int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                PendingIntent pi = PendingIntent.getActivity(this, id, status, flags);
                updateEvent("installing", -1, null);
                session.commit(pi.getIntentSender());
            }
        } catch (IOException | RuntimeException e) {
            updating = false;
            updateEvent("error", -1, "インストールを始められませんでした");
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleIntent(intent);
    }

    @SuppressWarnings("deprecation")
    private void handleIntent(Intent intent) {
        String open = openOf(intent);
        if (open != null) {
            web.evaluateJavascript("window.BR&&BR.push&&BR.push.openTarget(" + JSONObject.quote(open) + ")", null);
            return;
        }
        if (intent == null || !ACTION_INSTALL_STATUS.equals(intent.getAction())) return;
        if (!updating || !installToken.equals(intent.getStringExtra(EXTRA_TOKEN))) return;
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = Build.VERSION.SDK_INT >= 33
                    ? intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class)
                    : intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null) {
                updateEvent("confirm", -1, null);
                startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                return;
            }
        }
        updating = false;
        if (status == PackageInstaller.STATUS_SUCCESS) {
            updateEvent("done", -1, null);
        } else if (status == PackageInstaller.STATUS_FAILURE_ABORTED) {
            updateEvent("cancelled", -1, null);
        } else {
            String msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
            updateEvent("error", -1, status == PackageInstaller.STATUS_FAILURE_CONFLICT || status == PackageInstaller.STATUS_FAILURE_INCOMPATIBLE
                    ? "このアプリの上に入れられませんでした。いったんアプリを削除してから新しいアプリを入れてください"
                    : "インストールできませんでした" + (msg != null ? "（" + msg + "）" : ""));
        }
    }

    /* ------------------------------------------------------------ helpers --- */

    @SuppressWarnings("deprecation")
    private byte[] installedCert() {
        try {
            PackageManager pm = getPackageManager();
            if (Build.VERSION.SDK_INT >= 28) {
                PackageInfo info = pm.getPackageInfo(getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
                Signature[] s = info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners();
                return s != null && s.length > 0 ? s[0].toByteArray() : null;
            }
            PackageInfo info = pm.getPackageInfo(getPackageName(), PackageManager.GET_SIGNATURES);
            return info.signatures != null && info.signatures.length > 0 ? info.signatures[0].toByteArray() : null;
        } catch (PackageManager.NameNotFoundException e) {
            return null;
        }
    }

    private static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String sha256Hex(byte[] data) {
        return toHex(sha256().digest(data));
    }

    private static String toHex(byte[] b) {
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) sb.append(String.format("%02x", x));
        return sb.toString();
    }

    /* ------------------------------------------------------------ notifications --- */

    private SharedPreferences prefs() {
        return getSharedPreferences("app", MODE_PRIVATE);
    }

    private void makeChannels() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        NotificationChannel msg = new NotificationChannel(CH_MESSAGES, "メッセージと招待", NotificationManager.IMPORTANCE_HIGH);
        msg.setDescription("友達や運営からのメッセージ、「一緒に稼ぐ」の招待");
        msg.enableVibration(true);
        msg.setVibrationPattern(new long[] {0, 200, 100, 200});
        NotificationChannel calls = new NotificationChannel(CH_CALLS, "通話", NotificationManager.IMPORTANCE_HIGH);
        calls.setDescription("友達からの通話の呼び出し");
        calls.enableVibration(true);
        calls.setVibrationPattern(new long[] {0, 400, 200, 400, 200, 400});
        nm.createNotificationChannel(msg);
        nm.createNotificationChannel(calls);
    }

    private String notifyStateNow() {
        if (prefs().getBoolean("notify_off", false)) return "default";
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return prefs().getBoolean("notify_asked", false) && !shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)
                    ? "denied" : "default";
        }
        return nm.areNotificationsEnabled() ? "granted" : "denied";
    }

    private void tellNotifyState() {
        String js = "window.BRNative&&BRNative.notifyState&&BRNative.notifyState(" + JSONObject.quote(notifyStateNow()) + ")";
        web.evaluateJavascript(js, null);
    }

    /** Where a notification leads in the game ("dm:12", "group:3", "friends"), or null. */
    private static String openOf(Intent intent) {
        String open = intent == null ? null : intent.getStringExtra(EXTRA_OPEN);
        return open != null && open.matches("(dm|group):\\d{1,12}|friends") ? open : null;
    }

    @SuppressWarnings("deprecation")
    private void showNotification(String title, String body, String tag, boolean call, String open) {
        if (!"granted".equals(notifyStateNow())) return;
        Intent go = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (open != null && !open.isEmpty()) go.putExtra(EXTRA_OPEN, open);
        int id = tag == null ? 0 : tag.hashCode();
        PendingIntent pi = PendingIntent.getActivity(this, id, go, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, call ? CH_CALLS : CH_MESSAGES)
                : new Notification.Builder(this).setDefaults(Notification.DEFAULT_ALL).setPriority(Notification.PRIORITY_HIGH);
        b.setSmallIcon(call ? android.R.drawable.stat_sys_phone_call : android.R.drawable.stat_notify_chat)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setCategory(call ? Notification.CATEGORY_CALL : Notification.CATEGORY_MESSAGE)
                .setAutoCancel(true)
                .setContentIntent(pi);
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(id, b.build());
    }

    /* ------------------------------------------------------------ lifecycle --- */

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        hideBars();
        // back from "install unknown apps": carry on if it was allowed
        if (pendingApk != null && Build.VERSION.SDK_INT >= 26) {
            File apk = pendingApk;
            pendingApk = null;
            if (getPackageManager().canRequestPackageInstalls()) {
                install(apk);
            } else {
                updating = false;
                updateEvent("error", -1, "「このアプリからのインストールを許可」がオフのため、アップデートできませんでした");
            }
        }
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            root.removeView(web);
            web.destroy();
        }
        super.onDestroy();
    }
}
