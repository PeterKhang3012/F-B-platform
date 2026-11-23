package com.example.d2cplatform.ui.owner

import android.content.Intent
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.View
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import java.util.concurrent.Executors
import org.json.JSONArray
import org.json.JSONObject

class OwnerActivity : AppCompatActivity() {
    private val worker = Executors.newSingleThreadExecutor()
    private val handler = Handler(Looper.getMainLooper())
    private var api: OwnerApi? = null
    private lateinit var page: LinearLayout
    private lateinit var scroll: ScrollView
    private var active = false
    private var pendingRequest = false
    private var lastDashboard: String? = null
    private var showOrders = true
    private var pendingOrders = false

    private val poll = object : Runnable {
        override fun run() {
            if (!active) return
            refresh()
            handler.postDelayed(this, 2500)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        login()
    }

    override fun onStart() {
        super.onStart()
        active = true
        handler.post(poll)
    }

    override fun onStop() {
        active = false
        handler.removeCallbacks(poll)
        super.onStop()
    }

    override fun onDestroy() {
        worker.shutdownNow()
        super.onDestroy()
    }

    private fun column(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        val spacing = (16 * resources.displayMetrics.density).toInt()
        setPadding(spacing, spacing, spacing, spacing)
    }

    private fun newPage(title: String) {
        page = column()
        scroll = ScrollView(this).apply {
            clipToPadding = false
            addView(page)
        }
        setContentView(scroll)
        label(title, 26f)
    }

    private fun label(value: String, size: Float = 16f) {
        page.addView(TextView(this).apply {
            text = value
            textSize = size
            setPadding(0, 8, 0, 8)
        })
    }

    private fun button(title: String, action: () -> Unit) {
        page.addView(Button(this).apply {
            text = title
            setOnClickListener { action() }
        })
    }

    private fun field(parent: LinearLayout, hint: String, value: String = "", type: Int = InputType.TYPE_CLASS_TEXT): EditText =
        EditText(this).apply {
            this.hint = hint
            inputType = type
            setText(value)
            parent.addView(this)
        }

    private fun login() {
        if (api != null) stopService(Intent(this, OwnerOrderAlarmService::class.java))
        api = null
        pendingOrders = false
        lastDashboard = null
        newPage("Đăng nhập chủ quán")
        val address = field(page, "Địa chỉ máy chủ", "http://10.0.2.2:8787", InputType.TYPE_TEXT_VARIATION_URI)
        val password = field(page, "Mật khẩu", type = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
        button("Đăng nhập") {
            try {
                val client = OwnerApi(address.text.toString())
                val body = payload("password" to password.text.toString())
                runRequest({
                    client.token = client.request("/owner/login", body).getString("token")
                    JSONObject()
                }) {
                    api = client
                    newPage("Đang tải dữ liệu quán…")
                    refresh()
                }
            } catch (error: IllegalArgumentException) {
                notify(error.message ?: "Địa chỉ máy chủ không hợp lệ")
            }
        }
    }

    private fun runRequest(work: () -> JSONObject, quiet: Boolean = false, complete: (JSONObject) -> Unit) {
        if (pendingRequest) return
        pendingRequest = true
        worker.execute {
            val result = runCatching(work)
            runOnUiThread {
                pendingRequest = false
                if (isDestroyed || isFinishing) return@runOnUiThread
                result.onSuccess(complete).onFailure { error ->
                    if (error is OwnerApiError && error.status == 401 && api != null) {
                        login()
                        notify(error.message ?: "Vui lòng đăng nhập lại")
                    } else if (!quiet) {
                        notify(error.message ?: "Không kết nối được máy chủ")
                    } else if (lastDashboard == null) {
                        label("Không tải được dữ liệu quán")
                        button("Thử lại") { refresh() }
                        lastDashboard = ""
                    }
                }
            }
        }
    }

    private fun refresh() {
        val client = api ?: return
        runRequest({ client.request("/owner/dashboard") }, quiet = true) { data ->
            val hasPendingOrders = data.rows("orders").any { it.optString("status") == "PENDING" }
            if (active && hasPendingOrders != pendingOrders) {
                val alarm = Intent(this, OwnerOrderAlarmService::class.java)
                    .putExtra("url", client.base)
                    .putExtra("token", client.token)
                if (hasPendingOrders) {
                    if (Build.VERSION.SDK_INT >= 26) startForegroundService(alarm) else startService(alarm)
                } else stopService(alarm)
                pendingOrders = hasPendingOrders
            }
            val snapshot = data.toString()
            if (snapshot != lastDashboard) {
                val previousY = scroll.scrollY
                lastDashboard = snapshot
                dashboard(data)
                scroll.post { scroll.scrollTo(0, previousY) }
            }
        }
    }

    private fun change(path: String, body: JSONObject? = JSONObject(), method: String = "POST") {
        val client = api ?: return
        if (pendingRequest) {
            notify("Đang cập nhật, vui lòng thử lại")
            return
        }
        runRequest({ client.request("/owner/$path", body, method) }) { refresh() }
    }

    private fun dashboard(data: JSONObject) {
        val shop = data.getJSONObject("shop")
        newPage(shop.optString("name").ifBlank { "Chủ quán" })
        label("Trạng thái quán · " + when (shop.optString("status")) {
            "OPEN" -> "Đang mở"
            "BUSY" -> "Đang bận"
            else -> "Đóng cửa"
        })
        button(if (showOrders) "Quản lý quán và thực đơn" else "Đơn hàng và màn hình bếp") {
            showOrders = !showOrders
            dashboard(data)
        }
        if (showOrders) {
            label("Đơn hàng và màn hình bếp", 20f)
            if (data.rows("orders").isEmpty()) label("Chưa có đơn hàng")
            data.rows("orders").forEach { order(it, data.optBoolean("demo")) }
        } else {
            shopControls(shop)
            menu(data)
        }
        button("Đăng xuất") {
            if (!pendingRequest) login()
        }
    }

    private fun order(order: JSONObject, demo: Boolean) {
        val status = order.optString("status")
        val id = order.optString("id")
        val path = "orders/${android.net.Uri.encode(id)}/"
        label("$id · ${orderStatus(status)}", 20f)
        if (order.optBoolean("late")) label("⚠ Đơn giao quá lâu", 18f)
        label("${order.optInt("total")} đ · ${order.optString("payment")} · ${order.optString("address")}")
        order.rows("lines").forEach { line ->
            val toppings = line.optJSONArray("toppings")
            val names = (0 until (toppings?.length() ?: 0)).map { toppings!!.getString(it) }
            label("${line.optInt("quantity")} × ${line.optString("name")} · ${line.optString("size")}" +
                if (names.isEmpty()) "" else " · ${names.joinToString()}")
            line.optString("note").takeIf { it.isNotBlank() }?.let { note ->
                page.addView(TextView(this).apply {
                    text = "⚠ YÊU CẦU BẾP · $note"
                    textSize = 20f
                    setTypeface(typeface, Typeface.BOLD)
                    setTextColor(android.graphics.Color.rgb(92, 38, 0))
                    setBackgroundColor(android.graphics.Color.rgb(255, 223, 153))
                    setPadding(16, 12, 16, 12)
                })
            }
        }
        order.optString("note").takeIf { it.isNotBlank() }?.let { label("Ghi chú giao · $it") }
        order.optJSONObject("driver")?.let {
            label("Tài xế · ${it.optString("name")} · ${it.optString("phone")} · ${it.optString("plate")}")
        }
        when (status) {
            "PENDING" -> {
                button("Xác nhận nhận đơn") { change(path + "accept") }
                button("Từ chối đơn") {
                    form("Từ chối đơn", build = { listOf(field(it, "Lý do từ chối")) }) { fields ->
                        change(path + "reject", payload("reason" to fields[0].value()))
                    }
                }
            }
            "CONFIRMED" -> button("Đã đóng gói") { change(path + "pack") }
            "PACKED" -> button("Gọi Shipper") { change(path + "dispatch") }
            "REJECTED" -> {
                label("Lý do · ${order.optString("reason")}")
                if (order.has("refundStatus")) label("Hoàn tiền · " + when (order.optString("refundStatus")) {
                    "REFUNDED" -> "Đã hoàn tiền"
                    "FAILED" -> "Hoàn tiền thất bại"
                    else -> "Đã yêu cầu hoàn tiền"
                })
            }
            "FINDING_DRIVER", "DRIVER_ARRIVED", "PICKED_UP", "DELIVERING" ->
                if (demo) button("Mô phỏng bước giao tiếp theo") { change(path + "demo-next") }
        }
    }

    private fun orderStatus(status: String) = when (status) {
        "PENDING" -> "Đơn mới"
        "CONFIRMED" -> "Đang chuẩn bị"
        "PACKED" -> "Đã đóng gói"
        "REJECTED" -> "Đã từ chối"
        "FINDING_DRIVER" -> "Đang điều phối tài xế"
        "DRIVER_ARRIVED" -> "Tài xế đã đến quán"
        "PICKED_UP" -> "Đã lấy món"
        "DELIVERING" -> "Đang giao"
        "DELIVERED" -> "Giao thành công"
        else -> status
    }

    private fun shopControls(shop: JSONObject) {
        button("Sửa hồ sơ quán") {
            form("Hồ sơ quán", build = {
                listOf(field(it, "Tên quán", shop.optString("name")),
                    field(it, "Số điện thoại", shop.optString("phone")),
                    field(it, "Địa chỉ quán", shop.optString("address")),
                    field(it, "Vĩ độ", shop.optString("latitude"), InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL or InputType.TYPE_NUMBER_FLAG_SIGNED),
                    field(it, "Kinh độ", shop.optString("longitude"), InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL or InputType.TYPE_NUMBER_FLAG_SIGNED))
            }) { fields ->
                change("shop/profile", payload("name" to fields[0].value(), "phone" to fields[1].value(),
                    "address" to fields[2].value(), "latitude" to fields[3].coordinate(),
                    "longitude" to fields[4].coordinate()))
            }
        }
        button("Đổi trạng thái quán") {
            choose("Trạng thái", listOf("Mở cửa", "Đóng cửa", "Theo lịch", "Bận 15 phút",
                "Bận 30 phút", "Bận 1 giờ", "Bận 1 ngày")) { choice ->
                val mode = listOf("OPEN", "CLOSED", "SCHEDULE").getOrNull(choice)
                change("shop/mode", if (mode != null) payload("mode" to mode)
                    else payload("mode" to "BUSY", "minutes" to listOf(15, 30, 60, 1440)[choice - 3]))
            }
        }
        button("Lịch hằng tuần") {
            choose("Ngày trong tuần", listOf("Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư",
                "Thứ năm", "Thứ sáu", "Thứ bảy")) { day ->
                scheduleForm(day, shop.optJSONArray("week")?.optJSONObject(day))
            }
        }
        button("Lịch tùy chỉnh theo ngày") { scheduleForm(null, null) }
        val overrides = shop.optJSONObject("overrides")
        overrides?.keys()?.asSequence()?.sorted()?.forEach { date ->
            val hours = overrides.optJSONObject(date)
            label("$date · " + if (hours == null) "Đóng cửa" else "${hours.optString("from")} – ${hours.optString("to")}")
        }
    }

    private fun scheduleForm(day: Int?, hours: JSONObject?) {
        form("Lịch mở cửa", build = { box ->
            listOfNotNull(if (day == null) field(box, "Ngày (YYYY-MM-DD)") else null,
                field(box, "Giờ mở HH:mm", hours?.optString("from").orEmpty()),
                field(box, "Giờ đóng HH:mm", hours?.optString("to").orEmpty()),
                CheckBox(this).apply { text = "Đóng cửa ngày này"; isChecked = day != null && hours == null; box.addView(this) },
                if (day == null) CheckBox(this).apply { text = "Xóa ngoại lệ, dùng lịch tuần"; box.addView(this) } else null)
        }) { fields ->
            val startIndex = if (day == null) 1 else 0
            val closed = (fields[startIndex + 2] as CheckBox).isChecked
            val value = if (closed) JSONObject.NULL else payload(
                "from" to (fields[startIndex] as EditText).value(), "to" to (fields[startIndex + 1] as EditText).value())
            val body = if (day == null) payload("date" to (fields[0] as EditText).value(),
                "reset" to (fields[4] as CheckBox).isChecked, "hours" to value)
                else payload("day" to day, "hours" to value)
            change("shop/schedule", body)
        }
    }

    private fun menu(data: JSONObject) {
        val groups = data.rows("groups")
        val items = data.rows("items")
        label("Thực đơn", 20f)
        button("Thêm nhóm món") { groupForm(null) }
        if (groups.isNotEmpty()) button("Thêm món") { itemForm(groups, null) }
        groups.forEach { group ->
            val groupId = group.getString("id")
            label(group.getString("name"), 19f)
            button("Sửa hoặc xóa nhóm") {
                choose(group.getString("name"), listOf("Sửa nhóm", "Xóa nhóm")) {
                    if (it == 0) groupForm(group) else confirmDelete("groups/$groupId")
                }
            }
            items.filter { it.optString("groupId") == groupId }.forEach { item ->
                val name = item.getString("name")
                button("$name · ${item.optInt("price")} đ" + if (item.optBoolean("available")) "" else " · Hết hàng") {
                    choose(name, listOf("Sửa món", "Xóa món")) {
                        if (it == 0) itemForm(groups, item) else confirmDelete("items/${item.getString("id")}")
                    }
                }
            }
        }
    }

    private fun confirmDelete(path: String) {
        AlertDialog.Builder(this).setTitle("Xóa khỏi thực đơn?")
            .setNegativeButton("Hủy", null)
            .setPositiveButton("Xóa") { _, _ -> change(path, null, "DELETE") }
            .show()
    }

    private fun groupForm(group: JSONObject?) {
        form("Nhóm món", build = { listOf(field(it, "Tên nhóm", group?.optString("name").orEmpty())) }) { fields ->
            change(if (group == null) "groups" else "groups/${group.getString("id")}",
                payload("name" to fields[0].value()))
        }
    }

    private fun itemForm(groups: List<JSONObject>, item: JSONObject?) {
        form("Món ăn", build = { box ->
            val groupChoices = RadioGroup(this)
            groups.forEachIndexed { index, group ->
                groupChoices.addView(RadioButton(this).apply { id = index + 1; text = group.getString("name") })
            }
            val selected = groups.indexOfFirst { it.optString("id") == item?.optString("groupId") }
            groupChoices.check(selected.coerceAtLeast(0) + 1)
            box.addView(groupChoices)
            listOf(groupChoices,
                field(box, "Tên món", item?.optString("name").orEmpty()),
                field(box, "Giá món (đ)", item?.optString("price").orEmpty(), InputType.TYPE_CLASS_NUMBER),
                field(box, "Size bắt buộc · ví dụ Thường=0, Lớn=10000", menuOptions(item, "sizes")),
                field(box, "Topping · Thêm chả=5000 hoặc Thêm chả=5000=hết", menuOptions(item, "toppings")),
                CheckBox(this).apply { text = "Còn hàng"; isChecked = item?.optBoolean("available") ?: true; box.addView(this) })
        }) { fields ->
            val group = groups[(fields[0] as RadioGroup).checkedRadioButtonId - 1]
            change(if (item == null) "items" else "items/${item.getString("id")}", payload(
                "groupId" to group.getString("id"), "name" to (fields[1] as EditText).value(),
                "price" to (fields[2] as EditText).number(), "sizes" to parseOptions((fields[3] as EditText).value()),
                "toppings" to parseOptions((fields[4] as EditText).value(), toppings = true), "available" to (fields[5] as CheckBox).isChecked))
        }
    }

    private fun menuOptions(item: JSONObject?, key: String): String =
        item?.rows(key)?.joinToString {
            "${it.getString("name")}=${it.getInt("surcharge")}" +
                if (key == "toppings" && !it.optBoolean("available", true)) "=hết" else ""
        }.orEmpty()

    private fun parseOptions(value: String, toppings: Boolean = false): JSONArray {
        if (value.isBlank()) return JSONArray()
        return JSONArray(value.split(",").map {
            val parts = it.split("=").map(String::trim)
            val unavailable = toppings && parts.size == 3 && parts[2].equals("hết", ignoreCase = true)
            require((parts.size == 2 || unavailable) && parts[0].isNotBlank()) {
                "Nhập Tên=Phụ thu, thêm =hết cho topping đã hết"
            }
            val price = parts[1].toIntOrNull() ?: throw IllegalArgumentException("Phụ thu phải là số nguyên")
            payload("name" to parts[0], "surcharge" to price).apply {
                if (toppings) put("available", !unavailable)
            }
        })
    }

    private fun choose(title: String, values: List<String>, selected: (Int) -> Unit) {
        AlertDialog.Builder(this).setTitle(title)
            .setItems(values.toTypedArray()) { _, index -> selected(index) }.show()
    }

    private fun <T : View> form(title: String, build: (LinearLayout) -> List<T>, submit: (List<T>) -> Unit) {
        val contents = column()
        val fields = build(contents)
        val dialog = AlertDialog.Builder(this).setTitle(title)
            .setView(ScrollView(this).apply { addView(contents) })
            .setNegativeButton("Hủy", null).setPositiveButton("Lưu", null).show()
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
            if (pendingRequest) {
                notify("Đang cập nhật, vui lòng thử lại")
                return@setOnClickListener
            }
            try {
                submit(fields)
                dialog.dismiss()
            } catch (error: IllegalArgumentException) {
                notify(error.message ?: "Dữ liệu không hợp lệ")
            }
        }
    }

    private fun notify(message: String) = Toast.makeText(this, message, Toast.LENGTH_LONG).show()

    private fun EditText.value() = text.toString().trim()
    private fun EditText.coordinate() = value().replace(',', '.').toDoubleOrNull()?.takeIf(Double::isFinite)
        ?: throw IllegalArgumentException("Nhập tọa độ hợp lệ")

    private fun EditText.number() = value().toIntOrNull() ?: throw IllegalArgumentException("Nhập số nguyên hợp lệ")

    private fun JSONObject.rows(key: String): List<JSONObject> {
        val values = optJSONArray(key) ?: return emptyList()
        return (0 until values.length()).map(values::getJSONObject)
    }

    private fun payload(vararg entries: Pair<String, Any>): JSONObject = JSONObject().apply {
        entries.forEach { (key, value) -> put(key, value) }
    }
}
