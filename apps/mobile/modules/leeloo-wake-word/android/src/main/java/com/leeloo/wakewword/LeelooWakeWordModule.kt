package com.leeloo.wakewword

import android.content.Intent
import android.os.Build
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class LeelooWakeWordModule : Module() {

    companion object {
        private const val TAG = "LeelooWakeWordModule"
    }

    override fun definition() = ModuleDefinition {
        Name("LeelooWakeWord")

        Function("startForegroundService") {
            val ctx = appContext.reactContext ?: return@Function
            Log.d(TAG, "startForegroundService called")
            val intent = Intent(ctx, LeelooWakeWordService::class.java).apply {
                action = LeelooWakeWordService.ACTION_START
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(intent)
            } else {
                ctx.startService(intent)
            }
        }

        Function("stopForegroundService") {
            val ctx = appContext.reactContext ?: return@Function
            Log.d(TAG, "stopForegroundService called")
            val intent = Intent(ctx, LeelooWakeWordService::class.java).apply {
                action = LeelooWakeWordService.ACTION_STOP
            }
            ctx.startService(intent)
        }

        Function("isRunning") : Boolean {
            // Simplified check via a static flag set by the service
            return LeelooWakeWordServiceState.isRunning
        }
    }
}

object LeelooWakeWordServiceState {
    var isRunning: Boolean = false
}
