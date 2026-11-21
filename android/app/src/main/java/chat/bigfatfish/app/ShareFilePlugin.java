package chat.bigfatfish.app;

import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * 把 App 目录下的文件以 content:// 分享出去。
 *
 * 为什么不能直接用 @capacitor/share：
 *   Filesystem.writeFile 返回的是 file:///storage/emulated/0/Android/data/...
 *   这个 file:// URI 跨进程是没权限的。Share 插件把它原样塞进 Intent，
 *   接收方拿不到文件内容 —— 实测从文件管理器另存出来的文件只有 16 字节，
 *   扩展名也退化成 .txt。这不是内容问题，是 URI 形式错了。
 *
 * 正确做法：FileProvider.getUriForFile 生成 content://，
 * 配合 FLAG_GRANT_READ_URI_PERMISSION 授予读取权限，再 startActivity(ACTION_SEND)。
 *
 * path 是相对于 Directory.External 的路径，例如 "大肥鱼Chat/deepseek-file.html"。
 * 对应的实际目录是 getExternalFilesDir(null)。file_paths.xml 里的
 * external-files-path 已经覆盖了这个位置。
 */
@CapacitorPlugin(name = "ShareFile")
public class ShareFilePlugin extends Plugin {

    private static final String AUTHORITY_SUFFIX = ".fileprovider";

    @PluginMethod
    public void share(PluginCall call) {
        String path = call.getString("path");
        String mime = call.getString("mime", "application/octet-stream");
        String title = call.getString("title", "");

        if (path == null || path.isEmpty()) {
            call.reject("path is required");
            return;
        }

        try {
            File base = getContext().getExternalFilesDir(null);
            if (base == null) {
                call.reject("external files dir unavailable");
                return;
            }
            File target = new File(base, path);
            if (!target.exists()) {
                call.reject("file not found: " + path);
                return;
            }

            String authority = getContext().getPackageName() + AUTHORITY_SUFFIX;
            Uri uri = FileProvider.getUriForFile(getContext(), authority, target);

            Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setType(mime);
            intent.putExtra(Intent.EXTRA_STREAM, uri);
            if (!title.isEmpty()) {
                intent.putExtra(Intent.EXTRA_SUBJECT, title);
                intent.putExtra(Intent.EXTRA_TITLE, title);
            }
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            /*
             * 必须 setClipData。
             *
             * 只给 FLAG_GRANT_READ_URI_PERMISSION 不够：这个 flag 的作用范围是
             * 「最终被选中的接收方」，中间那一层分享面板（ChooserActivity）自己
             * 读不到 uri。实测 logcat 会警告：
             *   ChooserPreview: Could not read content://... stream types.
             *   If a preview is desired, call Intent#setClipData() ...
             * 结果是面板可能拿不到文件，某些接收方也跟着拿不到内容。
             *
             * setClipData 会把 uri 连同授权一起放进 ClipData，
             * 系统在任何环节都能读到，接收方才能拿到完整字节。
             */
            intent.setClipData(ClipData.newRawUri(title.isEmpty() ? "file" : title, uri));

            Intent chooser = Intent.createChooser(intent, title.isEmpty() ? null : title);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            getContext().startActivity(chooser);

            JSObject ret = new JSObject();
            ret.put("uri", uri.toString());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("share failed: " + e.getMessage(), e);
        }
    }
}
