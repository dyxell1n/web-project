# MEDIA CONVERTER
## Повний технічний посібник
Практичний розбір структури, архітектури, API та коду проєкту. Документ українською мовою, станом на 20 жовтня 2026 року. Опис ґрунтується на фактичних файлах цього репозиторію.
IMAGE 01-overview-crop.png|Головна сторінка застосунку з локального запуску http://localhost.

# Як користуватись цим посібником
Це пояснення того, що реалізовано зараз. Початкові документи можуть описувати планові функції; у тексті вони позначені окремо, щоб не плутати задум зі станом коду.
## Короткий опис
Застосунок дозволяє авторизованому користувачу запускати три види задач: перетворення зображень, архівацію одного файла та синтетичний CPU-тест. Сторінка показує статуси та прогрес у реальному часі, зберігає історію задач і дозволяє завантажити результат.
В інфраструктурі працюють сім контейнерів: один Nginx, два API, два воркери, PostgreSQL і Redis.
## Реалізовано та не реалізовано
Балансування між двома API, реєстрація/вхід з JWT, захищені задачі, історія, скасування, завантаження результату, прогрес через SSE, image conversion, ZIP/TAR.GZ, CPU stress test реалізовані.
ETA до старту, автоматичне масштабування воркерів, адмін-панель і збір CPU/RAM метрик не реалізовані. Модель SystemMetric у Prisma є, але writer/collector не знайдений. Відео- та аудіоконвертації немає: хоча ffmpeg встановлюється у контейнер, processor його не запускає.
Формат архіватора зараз ZIP або TAR.GZ для одного завантаженого файла, не довільної папки.
## Зміст
1. Архітектура та шлях даних
2. Docker Compose і збірка образу
3. Frontend-компоненти
4. REST API
5. Авторизація та доступ
6. База даних
7. Черга, воркери та події
8. Три процесори
9. Nginx, балансування та HTTPS
10. Налаштування, запуск і діагностика
11. Обмеження та зауваги до поточного коду
12. Карта файлів і термінів

# 1. Архітектура та шлях даних
Клієнтський браузер звертається до одного домену. Nginx приймає HTTP/HTTPS і проксить до api1 або api2. API обробляють легкі запити, auth та task management. Важке виконання відбувається у workers, окремо від API, а PostgreSQL тримає стан і Redis роздає роботу та події прогресу.
DIAGRAM
Компоненти:
- Browser/React: інтерфейс, API-запити, health ping, SSE-підписка.
- Nginx: єдина точка входу, round-robin upstream api1/api2.
- API 1/2: Express, статичні файли UI, auth і task routes.
- PostgreSQL: користувачі, задачі та метадані результатів.
- Redis: BullMQ queue, Pub/Sub прогресу, ключі скасування.
- Worker 1/2: виконують процесори; concurrency=1 на процес.
- Shared Docker volume: uploads та outputs доступні API і workers.
## Один запит від кнопки до файла
1. Workspace перевіряє авторизацію, наявність файла та обмеження розміру в браузері.
2. App.jsx створює multipart FormData: тип, JSON options і, якщо треба, input file.
3. Nginx передає HTTP до одного API. middleware ставить X-Served-By.
4. requireAuth перевіряє JWT. Multer записує файл з UUID-іменем до uploads.
5. POST /api/tasks перевіряє ліміт активних задач і розмір, створює Task у PostgreSQL зі статусом PENDING.
6. API додає job до BullMQ media-tasks, з jobId = task.id, attempts = 1.
7. Worker бере job, встановлює PROCESSING, workerId, startedAt та викликає процесор потрібного типу.
8. Процесор створює output у спільному сховищі. Worker записує статус, прогрес, тривалість та дані output у БД.
9. Worker публікує JSON у Redis Pub/Sub. API транслює його браузеру через SSE.
10. Frontend оновлює tracker та історію; download endpoint повертає готовий output.
Важливо: queue містить ідентифікатор, тип, параметри й метадані файла, не сам файл. Бінарні дані живуть у volume.

# 2. Docker Compose і збірка
docker-compose.yml визначає сім сервісів і мережу app_network. Три named volumes зберігають postgres_data, redis_data та storage_data.
Сервіси:
- db: postgres:16-alpine; healthcheck через pg_isready; база media_archiver.
- redis: redis:7-alpine; healthcheck через redis-cli ping.
- api1: збирається з backend/Dockerfile; SERVER_NAME=API_SERVER_1; запускає start:migrate.
- api2: той самий образ, SERVER_NAME=API_SERVER_2.
- worker1 і worker2: той самий backend image, але команда start:worker і WORKER_ID=WORKER_1/2.
- nginx: окремий образ nginx; публікує host ports 80 і 443.
API та workers монтують storage_data як /app/storage. API чекають на healthy DB і Redis; Nginx залежить від API.
## Dockerfile: два етапи
Builder використовує node:22-alpine, ставить системні інструменти та npm dependencies, генерує Prisma client, компілює TypeScript у dist і збирає React/Vite UI у public. Runner встановлює лише production npm dependencies та копіює dist і public.
При старті API команда start:migrate виконує prisma db push --skip-generate, потім запускає dist/index.js. Воркери запускають dist/worker.js.
Команди запуску:
```
docker compose up --build -d
docker compose ps
docker compose logs -f api1
docker compose logs -f worker1
docker compose down
```
Перевірки: http://localhost/health, http://localhost/api/status та https://localhost/health.

# 3. Frontend-компоненти
Фронтенд: React 19 + Vite. backend/index.html містить root mount; src/main.jsx монтує App та імпортує styles.css. App.jsx є координатором стану.
- App.jsx: token/user, auth modal, health ping і counters, task history, file/demo state, create/cancel task, EventSource.
- Header.jsx: навігація, login/logout, ім’я авторизованого користувача.
- Hero.jsx: заголовок, астронавт, картка тесту балансування API.
- TaskSelector.jsx: кнопки 01/02/03, зміна active task type.
- Workspace.jsx: форма опцій, upload dropzone, клієнтська валідація, tracker.
- TaskHistory.jsx: до 50 задач, статуси, прогрес, download, cancel/monitor controls.
- AuthDialog.jsx: форми входу/реєстрації; submit передається до App.
- styles.css: шрифти Microgamma/Eurostile, палітра, сітки та responsive breakpoints.
### Як стан проходить через React
App зберігає taskType і передає його TaskSelector та Workspace. Кнопки вибирають MEDIA_CONVERT, ARCHIVE_COMPRESS або SYNTHETIC_BENCHMARK. Workspace міняє набір полів відповідно до type. Після submit App створює FormData і надсилає POST. Після відповіді запускає monitor(taskId), що підписує браузер на SSE.
Auth token читається з localStorage за ключем jwt_token. На старті GET /api/auth/me відновлює користувача, а GET /api/tasks наповнює історію.
## Робоча область: параметри обробки
IMAGE 02-image-workspace.png|Конвертація: формат, необов’язкова ширина, якість, upload та live tracker.
PAGEBREAK
## Два інші режими
IMAGE 03-archive-workspace.png|Архівація: ZIP/TAR.GZ, рівень стискання та генерація прикладного файла.
IMAGE 04-benchmark-workspace.png|CPU stress test: складність 1-10 без upload input.

# 4. REST API
Маршрути монтуються в backend/src/index.ts. API зазвичай повертає JSON. Захищені маршрути приймають Authorization: Bearer <JWT>.
- GET /health - status, server name, uptime, timestamp; для перевірки живості та балансування.
- GET /api/status - пробує SELECT 1 у PostgreSQL і PING у Redis; показує ліміти.
- POST /api/auth/register - створює акаунт і повертає user + token.
- POST /api/auth/login - перевіряє пароль і повертає user + token.
- GET /api/auth/me - повертає декодований користувацький payload; потрібен JWT.
- POST /api/tasks/generate-demo - генерує авторизованому користувачу текстовий тестовий файл.
- POST /api/tasks - multipart створення та постановка задачі в чергу.
- GET /api/tasks - до 50 останніх задач поточного користувача.
- GET /api/tasks/:id - деталі власної задачі; ADMIN також може читати чужу.
- POST /api/tasks/:id/cancel - запит на кооперативне скасування.
- GET /api/tasks/:id/events - SSE потік стану задачі.
- GET /api/tasks/:id/download - завантажує результат COMPLETED задачі.
Помилки: 400 некоректні дані; 401 токен відсутній/недійсний; 403 немає права; 404 задача/файл не знайдені; 413 завеликий upload; 429 досягнуто ліміту активних задач; 500 внутрішня помилка.
Для SSE токен додається як ?token=..., бо вбудований EventSource не дозволяє custom Authorization headers. requireAuth приймає як Bearer, так і query token.

# 5. Авторизація і власність даних
AuthService нормалізує email (trim + lowercase), перевіряє наявність @, пароль мінімум 6 символів та унікальність email. Пароль хешується bcrypt із 10 salt rounds; plaintext пароль не зберігається.
Login знаходить користувача за email, bcrypt.compare звіряє passwordHash. JWT підписується даними id, email, role, name із строком JWT_EXPIRES_IN (default 7d).
requireAuth витягує токен із Authorization Bearer або query. Після verifyToken payload доступний як req.user. У task routes додатково перевіряється userId; ADMIN має доступ до чужих task records/files.
Frontend зберігає JWT у localStorage. На завантаженні App робить /api/auth/me. Якщо токен неправильний або протермінований, logout прибирає токен, користувача, історію та tracker.
Зверніть увагу: роль ADMIN є в enum і перевірках ownership, але окремої адмін-панелі або admin API у проєкті не знайдено.

# 6. База даних Prisma
backend/prisma/schema.prisma використовує PostgreSQL і генерує @prisma/client. Таблиці фізично зіставлені у нижній регістр users, tasks, system_metrics.
- Role: USER, ADMIN.
- TaskStatus: PENDING, QUEUED, PROCESSING, COMPLETED, FAILED, CANCELLED.
- TaskType: ARCHIVE_COMPRESS, MEDIA_CONVERT, SYNTHETIC_BENCHMARK.
- User: UUID id, унікальний email, passwordHash, необов’язкове name, role, createdAt/updatedAt, relation tasks.
- Task: UUID id, userId relation з onDelete Cascade, type/status/progress/stage, input/output file metadata, JSON options, executionTimeMs, workerId, handledByServer, errorMessage і timestamps.
- Індекси Task: userId та status.
- SystemMetric: nodeName/type, cpuPercent, memPercent, activeJobs, timestamp. У поточних TS-файлах не знайдений writer для цієї таблиці.
Task тримає метадані та статус, а файли лежать на диску/volume. При видаленні користувача пов’язані записи задач видаляються через cascade.
start:migrate використовує prisma db push, тому окремі versioned migration файли не потрібні для цього стартового сценарію; у репозиторії міграцій не знайдено.

# 7. Redis, BullMQ та worker lifecycle
src/queue/redis.ts створює Redis connection і BullMQ Queue media-tasks. src/worker.ts підключає BullMQ Worker до тієї самої черги. У compose два worker процеси, кожен concurrency=1; одночасно кластер може обробити дві задачі, решта чекає.
Job містить taskId, userId, type, inputFileName, inputFileSize, options. jobId дорівнює task UUID, attempts=1.
## Стани
PENDING - API зберіг запис перед постановкою у чергу. QUEUED є в enum, але create route не ставить це значення. PROCESSING - воркер узяв job. COMPLETED - output готовий. FAILED - помилка або timeout. CANCELLED - користувач попросив зупинити задачу.
Після старту воркер встановлює startedAt, workerId, 5% і “Assigned to a worker”. В кінці фіксує completedAt, executionTimeMs, output names/size/format. Помилка записує errorMessage.
## Event stream
Processor викликає callback прогресу. Worker reportProgress оновлює PostgreSQL і publishTaskProgress у Redis. publisher надсилає JSON в task:progress:<taskId> і кешує task:latest:<taskId> на 3600 секунд. SSE endpoint спершу віддає стан із БД, потім підписується на Redis канал, віддає data: JSON події та закриває з’єднання на terminal state. Keepalive коментар йде кожні 15 секунд.
React створює EventSource, обробляє JSON і оновлює tracker. Коли статус COMPLETED/FAILED/CANCELLED, закриває stream і перечитує історію.
## Скасування і timeout
Cancel route ставить Redis key task:cancel:<id> на годину та публікує cancel event. Обробники періодично читають ключ і кидають TASK_CANCELLED. Для ZIP є перевірка раз на 500 мс. Worker визначає cancel, оновлює статус і прибирає неповний output.
Timeout налаштований на TASK_TIMEOUT_SECONDS через Promise.race. Він відхиляє очікування після дедлайну, записує FAILED і видаляє output якщо той існує. Promise виконання не отримує AbortSignal, тому timeout сам по собі не гарантує миттєве припинення CPU/IO всередині процесора.

# 8. Процесори
## Image conversion - Sharp
Файл backend/src/processors/image.processor.ts. Формати WebP, AVIF, JPEG, PNG. За замовчуванням WebP, quality=80. Ширина необов’язкова; resize fit=inside, withoutEnlargement=true, тобто зберігає пропорції і не збільшує маленькі картинки.
Етапи прогресу: 10 metadata read, 30 resize setup, 60 encoding, 85 output write, 100 completed. Якість clamp до 1-100. PNG задає compressionLevel=9. Результат пишеться в outputPath, розмір читається через fs.stat.
## Archive compression
Файл archive.processor.ts. Формат zip або tar.gz, compressionLevel default 9 та допустимий діапазон UI 1-9. ZIP реалізований archiver/zlib, tar.gz бібліотекою tar з gzip. ZIP отримує прогрес із кількості оброблених bytes. TAR.GZ має крокові етапи. Поточна форма і маршрут оперують одним input file.
Generate-demo у task.routes.ts створює текстовий файл (default 5MB API; UI передає 10MB), обмежує розмір maxFileSizeMb, а потім цей файл можна передати до архіватора.
## Synthetic CPU benchmark
Файл benchmark.processor.ts. Не завантажує файл. Складність c clamp 1..10 задає n=80+25c, матриці Float64Array розміру n×n. У 10 кроках виконується потрійний цикл матричного множення, що має складність порядку O(n³) на крок. Звіт JSON містить complexity, розмір матриці, operationsPerformed, executionTimeMs, opsPerSecond та timestamp.
Після кожного кроку yieldEventLoop віддає керування Node event loop, щоб обробити I/O та скасування.

# 9. Nginx, балансування та HTTPS
nginx/nginx.conf задає upstream backend_cluster з api1:3000 і api2:3000. За замовчуванням Nginx застосовує round-robin. Обидва virtual server-и проксить запит до цього upstream.
Заголовки: API middleware задає X-Served-By: API_SERVER_1/2. Nginx додає X-Handled-By з адресою upstream. Frontend health ping читає X-Served-By, замірює затримку і рахує локальні відповіді у стані поточної вкладки. Це не глобальна статистика кластера.
Для upload nginx client_max_body_size=60M, app limit зазвичай 50 MB. SSE: proxy_read_timeout=300s, proxy_buffering off, proxy_cache off; HTTP/1.1 upgrade headers задані.
HTTPS listener 443 використовує TLS 1.2/1.3. nginx/Dockerfile під час збірки генерує self-signed RSA cert на localhost. HTTP->HTTPS redirect закоментований. Отже HTTP і HTTPS доступні окремо, а браузер попереджатиме про локальний сертифікат. Це не автоматичний сертифікат від довіреного CA.
В UI важливо розрізняти API_SERVER_1/2 (хто відповів на health ping) і WORKER_1/2 (хто виконував важку задачу).

# 10. Налаштування, запуск та діагностика
Кореневий .env.example містить приклади конфігурації. docker-compose.yml передає у контейнер DATABASE_URL, REDIS_URL, STORAGE_PATH, JWT_SECRET та ліміти.
- NODE_ENV: development/production; впливає на логування Prisma.
- PORT: API port 3000.
- SERVER_NAME / WORKER_ID: ідентифікатори вузлів.
- DATABASE_URL / REDIS_URL: адреси сервісів. Всередині Docker використовуються hostnames db і redis.
- STORAGE_PATH: директорія файлів, у Compose /app/storage.
- JWT_SECRET / JWT_EXPIRES_IN: підпис JWT і строк дії (за замовчуванням 7d).
- MAX_FILE_SIZE_MB: default 50.
- MAX_CONCURRENT_TASKS_PER_USER: default 3 активні задачі.
- TASK_TIMEOUT_SECONDS: default 120 сек.
Інші змінні для POSTGRES credentials та локальних ports визначені у Compose/.env.example. Compose має свої fallback значення; перед зміною перевіряйте обидва місця.
Діагностика:
- Сервіси не стартують: docker compose ps і docker compose logs -f.
- БД/Redis disconnected: GET /api/status; звірити credentials/hostnames і логи api.
- Job не забирається: логи worker1/worker2, REDIS_URL і повідомлення “worker ready”.
- Upload rejected: розмір, active task limit, nginx limit 60M, app limit 50 MB.
- SSE не оновлюється: Network tab має показувати text/event-stream; перевірити Redis канал та nginx proxy_buffering off.
- Download 404: Task має бути COMPLETED і outputFileName має бути заданий; файл має існувати у volume outputs.
- HTTPS warning на localhost очікуваний для self-signed сертифіката.

# 11. Обмеження, безпека, технічні нюанси
- JWT_SECRET та DB passwords містять локальні fallback/приклади. Їх потрібно замінити перед будь-яким мережевим production deployment і не комітити реальні секрети.
- Self-signed TLS не дорівнює довіреному сертифікату для публічного сайту.
- requireAuth приймає token у URL query для SSE/download links; URL можуть потрапити до browser history або access logs. Для публічного deployment слід оцінити короткоживучі download grants або інший спосіб авторизації для EventSource.
- CORS увімкнений через cors() без origin allowlist; перед розміщенням у публічній мережі політику потрібно звузити.
- Timeout Promise.race не передає cancellation signal самому процесору.
- Розмір, якість, складність частково обмежує UI; клієнтська валідація не замінює серверну. У source є серверна перевірка file size, але для кожного параметра немає однаково суворої schema validation.
- Два worker-и з concurrency 1 - фіксована конфігурація. Динамічного autoscaling немає.
- ETA і чергова позиція не повертаються task API.
- Модель SystemMetric наразі не наповнюється у коді; окремого адмін-дашборда немає.
- ffmpeg та p7zip встановлюються в image, але переглянуті processors використовують Sharp, archiver та tar; не описуйте це як реалізовані відео/7z функції.
- У enum є QUEUED, але task create створює PENDING. Це не помилка саме по собі, але UI/документація мають узгоджувати словник станів.

# 12. Покажчик файлів і словник
Карта файлів:
- docker-compose.yml - сім сервісів, мережа та volumes.
- backend/Dockerfile - production builder/runner.
- backend/package.json - залежності та команди build/start/dev.
- backend/index.html, backend/vite.config.js - HTML entry і Vite output config.
- backend/src/index.ts - Express, static files, health/status, mounts.
- backend/src/config/env.ts - environment variables і fallback.
- backend/src/db/prisma.ts - Prisma Client singleton.
- backend/src/routes/auth.routes.ts - register/login/me.
- backend/src/routes/task.routes.ts - create/list/detail/cancel/events/download/demo.
- backend/src/services/auth.service.ts - bcrypt, логіка User і JWT.
- backend/src/middleware/auth.middleware.ts - requireAuth та optionalAuth.
- backend/src/middleware/upload.middleware.ts - Multer disk storage та size errors.
- backend/src/queue/redis.ts - Redis/BullMQ queue.
- backend/src/queue/events.ts - прогрес, Pub/Sub і cancel keys.
- backend/src/worker.ts - job dispatch, lifecycle та помилки.
- backend/src/processors - три алгоритми виконання.
- backend/src/utils/storage.ts - каталоги та file paths.
- backend/prisma/schema.prisma - DB models і enums.
- backend/src/ui - React components/styles.
- backend/public/img та backend/src/ui/fonts - картинки і шрифти.
- nginx - reverse proxy та TLS image.
- docs/TASK.txt - початкові вимоги.
- docs/ARCHITECTURE.md та README.md - документація, частина можливостей там планова.
Терміни:
API server - HTTP процес, приймає запити. Worker - фоновий виконавець. Queue/job - опис задачі в BullMQ/Redis. SSE - односторонній live event stream по HTTP. Volume - спільне persistent сховище Docker. JWT - підписаний токен ідентичності. Prisma - ORM і генератор типізованого клієнта.
Підсумок: головний шлях задачі вже повний - UI → Nginx → API → PostgreSQL/Redis → Worker → Storage → SSE/History/Download. Для публічного production потрібно доопрацювати секрети, TLS, CORS, валідацію, контроль зупинки timeout та операційний моніторинг.

