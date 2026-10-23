package top.mestario.app;

import android.os.Build;
import android.os.Bundle;
import android.view.Display;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

// Mestario: просим у системы самую высокую частоту экрана (90/120/144 Гц, если телефон умеет),
// иначе многие Android-телефоны держат приложения на 60 Гц. Анимации сами подстраиваются под частоту.
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        preferHighRefreshRate();
    }

    @Override
    public void onResume() {
        super.onResume();
        preferHighRefreshRate();
    }

    @SuppressWarnings("deprecation")
    private void preferHighRefreshRate() {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
            Display display = getWindowManager().getDefaultDisplay();
            Display.Mode current = display.getMode();
            Display.Mode best = current;
            for (Display.Mode mode : display.getSupportedModes()) {
                boolean sameSize = mode.getPhysicalWidth() == current.getPhysicalWidth()
                        && mode.getPhysicalHeight() == current.getPhysicalHeight();
                if (sameSize && mode.getRefreshRate() > best.getRefreshRate()) best = mode;
            }
            WindowManager.LayoutParams params = getWindow().getAttributes();
            params.preferredDisplayModeId = best.getModeId();
            params.preferredRefreshRate = best.getRefreshRate();
            getWindow().setAttributes(params);
        } catch (Exception ignored) {
            // на необычных устройствах просто остаётся частота по умолчанию
        }
    }
}
