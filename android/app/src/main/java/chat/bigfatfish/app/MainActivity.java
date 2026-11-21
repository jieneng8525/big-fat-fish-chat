package chat.bigfatfish.app;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Window;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * 主 Activity。
 *
 * 目标：状态栏和导航栏完全透明，WebView 的内容（含壁纸）一直铺到屏幕边缘。
 *
 * ⚠ 这里做过一次错误的尝试，记下来免得重犯：
 * 曾经用 ViewCompat.setOnApplyWindowInsetsListener 给 android.R.id.content
 * 加 padding(bars.top)，本意是「内容不被状态栏压住」。结果是把 WebView 整体
 * 往下推了状态栏高度（实测 63px），那 63px 露出的是窗口底色，
 * 在截图上表现为一条全宽纯灰（rgb 163,163,163）的横带，正好在状态栏下方。
 * 查证方式：`adb shell dumpsys window windows` 显示窗口本身
 * frame=[0,0][1080,2400]、flags 含 EDGE_TO_EDGE_ENFORCED —— 窗口没问题，
 * 是内容被 padding 推开了。
 *
 * 正确做法：不加 padding。WebView 铺满整屏，安全区由网页自己的 CSS 处理
 * （index.html 有 viewport-fit=cover 时可用 env(safe-area-inset-*)）。
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        /*
         * ⚠ 自定义插件必须在 super.onCreate() **之前**注册。
         *
         * BridgeActivity.onCreate 内部是这样的：
         *     super.onCreate(savedInstanceState);                 // 行 23
         *     bridgeBuilder.addPlugins(loader.loadPluginClasses()); // 行 37
         *     this.load();                                          // 行 42
         * load() 里执行 bridgeBuilder.create()，Bridge 一旦创建，插件列表就定死了。
         * 所以写在 super.onCreate() 之后调 registerPlugin() 只是往已建好的
         * Builder 上加，不会生效——实测 APK 里类编译进去了，但运行时
         * window.Capacitor.Plugins.OpenInBrowser 是 undefined。
         */
        registerPlugin(OpenInBrowserPlugin.class);
        registerPlugin(ShareFilePlugin.class);

        super.onCreate(savedInstanceState);

        Window window = getWindow();

        // 内容绘制到系统栏后方
        WindowCompat.setDecorFitsSystemWindows(window, false);

        // 系统栏透明
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);

        // 窗口自身背景透明：即使某一帧 WebView 还没绘制，也不会露出灰底
        window.setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(Color.TRANSPARENT));

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            // 刘海屏也铺满
            WindowManager.LayoutParams params = window.getAttributes();
            params.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(params);
        }

        // 状态栏图标用浅色（壁纸多为深色，深色图标会看不见）
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);
    }
}
