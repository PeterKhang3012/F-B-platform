package com.example.d2cplatform.ui.owner

import java.net.HttpURLConnection
import java.net.URI
import org.json.JSONObject

internal class OwnerApi(url: String) {
    val base = URI.create(url.trim().trimEnd('/')).also {
        require(it.scheme in listOf("http", "https") && it.host != null && it.userInfo == null &&
            it.query == null && it.fragment == null) { "Địa chỉ máy chủ không hợp lệ" }
        require(it.scheme == "https" || it.host in listOf("10.0.2.2", "127.0.0.1", "localhost")) {
            "Dùng HTTPS hoặc địa chỉ máy chủ demo cục bộ"
        }
    }.toString()
    var token: String = ""

    fun request(path: String, body: JSONObject? = null, method: String = if (body == null) "GET" else "POST"): JSONObject {
        val connection = URI(base + path).toURL().openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = 4000
            connection.readTimeout = 5000
            connection.instanceFollowRedirects = false
            if (token.isNotEmpty()) connection.setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val result = stream?.bufferedReader(Charsets.UTF_8)?.use { JSONObject(it.readText()) } ?: JSONObject()
            if (status !in 200..299) throw OwnerApiError(status, result.optString("error", "Lỗi HTTP $status"))
            return result
        } finally {
            connection.disconnect()
        }
    }
}

internal class OwnerApiError(val status: Int, message: String) : IllegalStateException(message)
