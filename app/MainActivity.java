package top.mestario.app;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.view.Display;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

// Mestario:
//  • просим у системы самую высокую частоту экрана (90/120/144 Гц, если телефон умеет),
//    иначе многие Android-телефоны держат приложения на 60 Гц. Анимации сами подстраиваются под частоту;
//  • «Динамик» в звонках: window.MestarioAudio.setSpeaker(true/false) — громкая связь или динамик у уха,
//    window.MestarioAudio.reset() — после звонка звук снова обычный.
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        preferHighRefreshRate();
        try {
            WebView wv = getBridge().getWebView();
            wv.addJavascriptInterface(new AudioBridge(), "MestarioAudio");
        } catch (Exception ignored) {
            // без моста кнопка «Динамик» просто не покажется
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        preferHighRefreshRate();
    }

    private class AudioBridge {
        @JavascriptInterface
        public void setSpeaker(final boolean on) { runOnUiThread(() -> applySpeaker(on)); }

        @JavascriptInterface
        public void reset() { runOnUiThread(MainActivity.this::resetAudio); }
    }

    @SuppressWarnings("deprecation")
    private void applySpeaker(boolean on) {
        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return;
            am.setMode(AudioManager.MODE_IN_COMMUNICATION);
            if (Build.VERSION.SDK_INT >= 31) {
                if (on) {
                    for (AudioDeviceInfo d : am.getAvailableCommunicationDevices()) {
                        if (d.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) { am.setCommunicationDevice(d); break; }
                    }
                } else {
                    am.clearCommunicationDevice();   // по умолчанию в разговоре — динамик у уха (или подключённые наушники)
                }
            } else {
                am.setSpeakerphoneOn(on);
            }
        } catch (Exception ignored) { }
    }

    @SuppressWarnings("deprecation")
    private void resetAudio() {
        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return;
            if (Build.VERSION.SDK_INT >= 31) am.clearCommunicationDevice(); else am.setSpeakerphoneOn(false);
            am.setMode(AudioManager.MODE_NORMAL);
        } catch (Exception ignored) { }
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
