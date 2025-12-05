# Remote WebView Server

Trình duyệt Headless browser hiển thị các trang web mục tiêu (ví dụ: bảng điều khiển Home Assistant) và truyền phát chúng dưới dạng các ô hình ảnh qua WebSocket đến các trang web nhẹ [clients](https://github.com/strange-v/RemoteWebViewClient) (ESP32 displays). Máy chủ hỗ trợ nhiều máy khách cùng lúc, mỗi máy khách có độ phân giải màn hình, hướng và cài đặt riêng cho từng thiết bị.
![Remote WebView](/images/tiled_preview.png)


## Tính năng

- hiển thị các trang trong môi trường Chromium không giao diện và các luồng diff được tạo thành các ô trên WebSocket.
- hợp nhất ô với tính năng phát hiện thay đổi để giảm số lượng gói tin và tải CPU
- dự phòng toàn khung hình theo nhịp/ngưỡng hoặc theo yêu cầu
- kích thước ô, chất lượng JPEG, kích thước tin nhắn WS và khoảng thời gian khung hình tối thiểu có thể cấu hình
- cài đặt cho từng máy khách: mỗi kết nối có thể cung cấp chiều rộng, chiều cao, Kích thước ô, Chất lượng JPEG, MaxBytesPerMessage, v.v. riêng.
- Cấu hình lại nóng: kết nối lại với các tham số mới sẽ cấu hình lại phiên thiết bị và kích hoạt làm mới toàn khung hình.
- Cổng khung thông minh hơn: điều tiết + nội dung băm bị loại bỏ (bỏ qua các khung giống hệt nhau)
- Không có người xem = không có công việc: các khung được ACK để tiếp tục phát trực tuyến Chromium, nhưng các ô không được mã hóa/xếp hàng khi không có người nghe.
 - Kết nối sự kiện chạm (xuống/di chuyển/lên) — hỗ trợ cuộn (chưa có cử chỉ)
- Điều hướng do máy khách điều khiển: máy khách có thể kiểm soát trang nào sẽ mở.
- Trang tự kiểm tra tích hợp để trực quan hóa và đo thời gian hiển thị
- Điểm cuối kiểm tra tình trạng hoạt động để điều phối container
- Tùy chọn truy cập DevTools qua proxy TCP

## Truy cập tab máy chủ bằng Chrome DevTools
1. Đảm bảo máy chủ của bạn hiển thị cổng DevTools (CDP) (ví dụ: 9222).
- Nếu bạn sử dụng container Docker thuần túy, hãy đảm bảo bạn đã cấu hình và khởi động `debug-proxy`
- Nếu sử dụng tiện ích bổ sung Ha OS, hãy bật `expose_debug_proxy`
1. Trong Chrome, hãy truy cập chrome://inspect/#devices → Configure… → thêm máy chủ của bạn: hostname_or_ip:9222.
1. Bạn sẽ thấy trang mà máy chủ đã mở (trang bạn muốn đăng nhập, ví dụ: Home Assistant). Nhấp vào inspect để mở toàn bộ cửa sổ DevTools cho tab đó.

## Thẻ hình ảnh & quản lý phiên bản

- mới nhất — bản phát hành ổn định mới nhất
- beta — bản tiền phát hành mới nhất (đang phát hành)
- phiên bản ngữ nghĩa: X.Y.Z, cùng với các thẻ tiện lợi X.Y, X trên các bản phát hành ổn định

Bạn có thể ghim một bản phát hành ổn định (`1.4.0`) hoặc theo dõi các kênh (`mới nhất`, `beta`) tùy thuộc vào chiến lược triển khai của bạn.

## Ví dụ về Docker Compose

```yaml
services:
  rwvserver:
    image: strangev/remote-webview-server:latest  # use :beta for pre-release
    container_name: remote-webview-server
    restart: unless-stopped
    environment:
      TILE_SIZE: 32
      FULL_FRAME_TILE_COUNT: 4
      FULL_FRAME_AREA_THRESHOLD: 0.5
      FULL_FRAME_EVERY: 50
      EVERY_NTH_FRAME: 1
      MIN_FRAME_INTERVAL_MS: 80
      JPEG_QUALITY: 85
      MAX_BYTES_PER_MESSAGE: 14336
      WS_PORT: 8081
      DEBUG_PORT: 9221 # internal debug port
      HEALTH_PORT: 18080
      PREFERS_REDUCED_MOTION: false
      USER_DATA_DIR: /pw-data
      BROWSER_LOCALE: "en-US"
    ports:
      - "8081:8081"                   # WebSocket stream
      - "9222:9222"                   # external DevTools via socat
    expose:
      - "18080"                       # health endpoint (internal)
      - "9221"                        # internal DevTools port
    volumes:
      - /opt/volumes/esp32-rdp/pw-data:/pw-data
    shm_size: 1gb
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:18080 || exit 1"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 10s

  debug-proxy:
    image: alpine/socat
    container_name: remote-webview-server-debug
    restart: unless-stopped
    network_mode: "service:rwvserver"
    depends_on:
      rwvserver:
        condition: service_healthy
    command:
      - "-d"
      - "-d"
      - "TCP-LISTEN:9222,fork,reuseaddr,keepalive" # external DevTools port
      - "TCP:127.0.0.1:9221"
```
