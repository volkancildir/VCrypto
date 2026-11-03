package com.vcrypto.app

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import android.app.Activity
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.io.File
import java.util.concurrent.TimeUnit

class MainActivity : Activity() {
    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        schedulePatternRefresh()
        webView = WebView(this)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.databaseEnabled = true
        webView.addJavascriptInterface(PatternBridge(), "AndroidPatternBridge")
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                return url == null || !url.startsWith("https://volkancildir.github.io/VCrypto/")
            }
        }
        setContentView(webView)
        webView.loadUrl("https://volkancildir.github.io/VCrypto/")
    }

    private fun schedulePatternRefresh() {
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val request = PeriodicWorkRequestBuilder<PatternRefreshWorker>(15, TimeUnit.MINUTES)
            .setConstraints(constraints).build()
        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            PatternRefreshWorker.WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, request
        )
    }

    inner class PatternBridge {
        @JavascriptInterface
        fun saveWatchlist(timeframe: String, symbolsCsv: String) {
            val allowed = setOf("1h", "4h", "1d", "1w", "1M", "1y")
            if (timeframe !in allowed) return
            val symbols = symbolsCsv.split(",").map { it.trim().uppercase() }
                .filter { it.matches(Regex("[A-Z0-9]{2,20}")) && it.endsWith("USDT") }.take(500)
            getSharedPreferences("pattern_worker", MODE_PRIVATE).edit()
                .putString("timeframe", timeframe).putString("symbols", symbols.joinToString(",")).apply()
        }

        @JavascriptInterface
        fun getPatternCache(key: String): String {
            val safe = key.replace(Regex("[^A-Za-z0-9:_-]"), "")
            val file = File(File(cacheDir, "pattern-cache"), "$safe.json")
            return if (file.exists()) file.readText() else ""
        }

        @JavascriptInterface
        fun putPatternCache(key: String, rawJson: String) {
            val safe = key.replace(Regex("[^A-Za-z0-9:_-]"), "")
            if (safe.isBlank() || rawJson.length > 2_000_000) return
            val dir = File(cacheDir, "pattern-cache").apply { mkdirs() }
            File(dir, "$safe.json.tmp").writeText(rawJson)
            File(dir, "$safe.json.tmp").renameTo(File(dir, "$safe.json"))
        }
    }
}
