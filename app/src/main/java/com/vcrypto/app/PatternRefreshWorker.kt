package com.vcrypto.app

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

class PatternRefreshWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    companion object { const val WORK_NAME = "vcrypto_pattern_refresh_15m" }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val prefs = applicationContext.getSharedPreferences("pattern_worker", Context.MODE_PRIVATE)
        val timeframe = prefs.getString("timeframe", null) ?: return@withContext Result.success()
        val symbols = prefs.getString("symbols", "").orEmpty().split(",").filter { it.endsWith("USDT") }
        if (symbols.isEmpty()) return@withContext Result.success()
        val (interval, limit) = when (timeframe) {
            "1h" -> "1h" to 120
            "4h" -> "4h" to 120
            "1d" -> "1d" to 120
            "1w" -> "1w" to 120
            "1M" -> "1M" to 100
            "1y" -> "1w" to 100
            else -> return@withContext Result.success()
        }
        val dir = File(applicationContext.cacheDir, "pattern-cache").apply { mkdirs() }
        var failures = 0
        for (symbol in symbols) {
            try {
                val url = URL("https://data-api.binance.vision/api/v3/klines?symbol=$symbol&interval=$interval&limit=$limit")
                val connection = (url.openConnection() as HttpURLConnection).apply {
                    connectTimeout = 12000; readTimeout = 12000; requestMethod = "GET"
                }
                val body = connection.inputStream.bufferedReader().use { it.readText() }
                connection.disconnect()
                val data = JSONArray(body)
                if (data.length() < 30) throw IllegalStateException("Insufficient candles")
                val safeKey = "$timeframe:$symbol"
                val file = File(dir, "$safeKey.json")
                val temp = File(dir, "$safeKey.json.tmp")
                temp.writeText(body)
                temp.renameTo(file)
            } catch (_: Exception) { failures++ }
        }
        // A partial refresh is useful; WorkManager will retry only if every request failed.
        if (failures == symbols.size) Result.retry() else Result.success()
    }
}
