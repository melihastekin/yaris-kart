/* =====================================================================
   FIRTINA KART - OYUNUN BÜTÜN MANTIĞI BU DOSYADA
   =====================================================================
   Bu dosyayı firtina-kart.html çağırır. Görünüm (renkler, yazı tipleri,
   menü kutuları) stil.css dosyasındadır.

   3 boyutlu çizim için "three.js" adlı hazır kütüphane kullanılıyor.
   Kodda THREE. ile başlayan her şey o kütüphaneden gelir.

   İÇİNDEKİLER
     1. Başlangıç ve yardımcı fonksiyonlar
     2. Sahne: gökyüzü, sis, kamera, ışık
     3. Pist (yolun şekli burada belirlenir)
     4. Zemin, yol, kenar şeritleri, bariyer, başlangıç takı
     5. Hızlandırma pedleri ve eşya kutuları
     6. Manzara: ölü ağaçlar, hurda, kayalıklar, duman, bacalar
     7. Kart modeli (araba + sürücü)
     8. Parçacıklar (kıvılcım, duman, patlama)
     9. Ses
    10. Yarışçılar
    11. Kontroller (klavye, dokunmatik) ve rakiplerin yapay zekâsı
    12. Eşyalar (nitro, roket, yağ, kalkan, tamir), zırh ve parçalanma
    13. Fizik: bir kartın hareketi
    14. Ekran göstergeleri ve mini harita
    15. Oyun durumu: menü, geri sayım, yarış, bitiş
    16. Ana döngü (her karede çalışan kısım)

   KOLAY DEĞİŞTİRİLEBİLECEK AYARLAR (dosyada arayarak bulabilirsin)
     LAPS      -> tur sayısı
     BASE_V    -> kartların en yüksek hızı
     HALF_W    -> yolun yarı genişliği
     CP        -> pistin köşe noktaları (pistin şekli)
     PCOLS     -> oyuncunun seçebileceği renkler
     AIS       -> rakiplerin adları ve renkleri
     TILT_FULL -> telefonu eğerek sürerken direksiyonun hassasiyeti
     TILT_CURVE / TILT_SMOOTH -> eğerek sürüşün yumuşaklığı
     MAX_HP, ROCKET_DMG, RAM_DMG ... -> zırh ve hasar miktarları
   ===================================================================== */

(function () {
  'use strict';

  /* ===================================================================
     1. BAŞLANGIÇ VE YARDIMCI FONKSİYONLAR
     =================================================================== */

  // $('kimlik') yazınca sayfadaki o id'ye sahip elemanı getirir (kısayol).
  const $ = id => document.getElementById(id);
  const canvas = $('game'); // oyunun çizildiği alan

  // Oyun açılamazsa menü kutusuna hata mesajı yazar.
  function fail(text) {
    $('menu').querySelector('.card').innerHTML = '<h2>Oyun açılamadı</h2><p>' + text + '</p>';
  }

  // three.js internetten yüklenemediyse oyunu başlatmadan çık.
  if (!window.THREE) {
    fail('3B kütüphanesi yüklenemedi. İnternet bağlantını kontrol edip sayfayı yenile.');
    return;
  }

  // "renderer" sahneyi ekrana çizen motordur.
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch (e) {
    fail('Tarayıcında WebGL kapalı görünüyor. Başka bir tarayıcıyla dene.');
    return;
  }
  // Yüksek çözünürlüklü ekranlarda keskin görünsün, ama en fazla 2 kat (performans için).
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const TAU = Math.PI * 2; // tam tur açı (360 derece)

  // Bir sayıyı en az a, en çok b olacak şekilde sınırlar.
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // İki açı arasındaki en kısa farkı verir (-180 ile +180 derece arası).
  function angDiff(a, b) {
    let d = (a - b) % TAU;
    if (d > Math.PI) d -= TAU;
    else if (d < -Math.PI) d += TAU;
    return d;
  }

  // Tohumlu rastgele sayı üreteci: her açılışta AYNI rastgele sayıları verir.
  // Böylece ağaçlar ve dağlar her seferinde aynı yerde olur.
  function rng(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const R = rng(20261114);

  // Kodla küçük bir resim çizip onu 3B yüzeylere kaplanacak "doku"ya çevirir.
  // Oyunda hiç resim dosyası yok; yol, çim, şeritler hep bu yolla çiziliyor.
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    return new THREE.CanvasTexture(c);
  }

  // Dokuların uzaktan bakınca bulanıklaşmaması için kalite ayarı.
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  // Bir renk sayısını (0xff0000) yazıya ("#ff0000") çevirir.
  const hex = c => '#' + c.toString(16).padStart(6, '0');


  /* ===================================================================
     2. SAHNE: GÖKYÜZÜ, SİS, KAMERA, IŞIK
     =================================================================== */

  const scene = new THREE.Scene();
  const HORIZON = 0x4a3428; // ufuk rengi (sis de bu renkte): duman ve pas rengi

  // Gökyüzü: yukarıda isli koyu gri, ufka doğru kızıl-turuncu bir alacakaranlık.
  scene.background = canvasTex(4, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#0f0d10');
    gr.addColorStop(0.3, '#2a1f1f');
    gr.addColorStop(0.48, '#7a3b1c');
    gr.addColorStop(0.56, '#4a3428');
    gr.addColorStop(1, '#4a3428');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });

  // Sis: uzaktaki şeyler ufuk rengine doğru solar (140 birimden başlar, 900'de tam solar).
  scene.fog = new THREE.Fog(HORIZON, 140, 900);

  // Kamera: 68 derece görüş açısı. Son iki sayı en yakın ve en uzak görüş mesafesi.
  const camera = new THREE.PerspectiveCamera(68, 1, 0.6, 2800);

  // Işıklar: biri her yeri yumuşakça aydınlatır, diğeri güneş gibi tek yönden vurur.
  // Karanlık bir dünya: zayıf, soğuk bir genel ışık ve alçaktan vuran turuncu bir akşam güneşi.
  scene.add(new THREE.HemisphereLight(0x9a8c86, 0x2a1d14, 0.75));
  const sun = new THREE.DirectionalLight(0xff9a55, 0.85);
  sun.position.set(-160, 90, 120);
  scene.add(sun);


  /* ===================================================================
     3. PİST
     ===================================================================
     Pist, CP listesindeki noktalardan geçen kapalı ve yumuşak bir eğridir.
     Her nokta [x, z] şeklinde kuşbakışı bir konumdur. Noktaları değiştirirsen
     pistin şekli değişir. Dikkat: yol kendi üstünden geçmemeli ve iki bölüm
     birbirine çok yaklaşmamalı (en az 45 birim), yoksa bariyerler iç içe girer.
     =================================================================== */

  const LAPS = 3;            // tur sayısı
  const N = 640;             // pist kaç küçük parçaya bölünecek (hesaplar bu parçalarla yapılır)
  const HALF_W = 8.5;        // yolun yarı genişliği
  const WALL = HALF_W + 13;  // yolun ortasından bariyere olan uzaklık
  const S = 1.35;            // pisti büyütme katsayısı

  const CP = [
    [-60, 0], [40, 0], [120, -5], [175, -40], [185, -100], [150, -145],
    [95, -140], [70, -95], [30, -70], [-15, -95], [-35, -150], [-90, -180],
    [-150, -160], [-175, -105], [-150, -55], [-120, -20]
  ];

  // Noktalardan yumuşak, kapalı bir eğri üret.
  const curve = new THREE.CatmullRomCurve3(
    CP.map(p => new THREE.Vector3(p[0] * S, 0, (p[1] + 90) * S)),
    true, 'centripetal'
  );
  const LEN = curve.getLength();       // pistin toplam uzunluğu
  const sp = curve.getSpacedPoints(N); // eğri üzerinde eşit aralıklı N nokta

  // Pistin her parçası için saklanan bilgiler:
  const px = new Float32Array(N); // parçanın x konumu
  const pz = new Float32Array(N); // parçanın z konumu
  const nx = new Float32Array(N); // yola dik yön (yana doğru), x bileşeni
  const nz = new Float32Array(N); // yola dik yön, z bileşeni
  const hd = new Float32Array(N); // yolun o noktadaki yönü (açı)

  for (let i = 0; i < N; i++) {
    px[i] = sp[i].x;
    pz[i] = sp[i].z;
  }
  for (let i = 0; i < N; i++) {
    const a = (i + N - 1) % N; // bir önceki parça
    const b = (i + 1) % N;     // bir sonraki parça
    let tx = px[b] - px[a];
    let tz = pz[b] - pz[a];
    const l = Math.hypot(tx, tz);
    tx /= l;
    tz /= l;
    nx[i] = tz;
    nz[i] = -tx;
    hd[i] = Math.atan2(tx, tz);
  }

  // Pist boyunca uzanan düz bir şerit üretir (yol, kenar şeridi, ped hep bununla yapılır).
  //   i0, i1 : şeridin başladığı ve bittiği parça numarası
  //   a, b   : şeridin iki kenarının yol ortasından uzaklığı
  //   y      : yerden yükseklik
  //   vOf    : dokunun yol boyunca nasıl tekrarlanacağını veren fonksiyon
  function ribbon(i0, i1, a, b, y, vOf) {
    const pos = [], uv = [], idx = [];
    for (let i = i0; i <= i1; i++) {
      const j = ((i % N) + N) % N;
      const v = vOf(i);
      pos.push(px[j] + nx[j] * a, y, pz[j] + nz[j] * a,
               px[j] + nx[j] * b, y, pz[j] + nz[j] * b);
      uv.push(0, v, 1, v);
      if (i < i1) {
        const k = (i - i0) * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }

  // Yere yapışık düz yüzeyler için malzeme. "po" büyüdükçe yüzey diğerlerinin
  // üstünde çizilir; böylece üst üste binen yüzeyler titreşmez.
  function flatMat(options, po) {
    return new THREE.MeshBasicMaterial(Object.assign({
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -po,
      polygonOffsetUnits: -po
    }, options));
  }


  /* ===================================================================
     4. ZEMİN, YOL, KENAR ŞERİTLERİ, BARİYER, BAŞLANGIÇ TAKI
     =================================================================== */

  const ISLAND = 350; // adanın yarıçapı

  // Zemin dokusu: kurumuş, yanık toprak. Koyu kahve üstüne pas ve kurum lekeleri, çatlaklar.
  const grassTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#3b2c22';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = R() < 0.4 ? 'rgba(150,70,30,.10)' : R() < 0.7 ? 'rgba(0,0,0,.14)' : 'rgba(200,170,130,.05)';
      const s = 4 + R() * 14;
      g.fillRect(R() * w, R() * h, s, s);
    }
    g.strokeStyle = 'rgba(0,0,0,.35)'; // çatlaklar
    g.lineWidth = 1.5;
    for (let i = 0; i < 14; i++) {
      let x = R() * w, y = R() * h;
      g.beginPath();
      g.moveTo(x, y);
      for (let j = 0; j < 5; j++) { x += (R() - 0.5) * 40; y += (R() - 0.5) * 40; g.lineTo(x, y); }
      g.stroke();
    }
  });
  grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
  grassTex.repeat.set(70, 70);
  grassTex.anisotropy = maxAniso;

  // Ada (yanık toprak), etrafındaki çakıl kıyı ve koyu, kirli deniz.
  const island = new THREE.Mesh(new THREE.CircleGeometry(ISLAND, 72), new THREE.MeshBasicMaterial({ map: grassTex }));
  island.rotation.x = -Math.PI / 2;
  scene.add(island);

  const sand = new THREE.Mesh(new THREE.CircleGeometry(ISLAND + 18, 72), new THREE.MeshBasicMaterial({ color: 0x2b2420 }));
  sand.rotation.x = -Math.PI / 2;
  sand.position.y = -0.35;
  scene.add(sand);

  const sea = new THREE.Mesh(new THREE.PlaneGeometry(7000, 7000), new THREE.MeshBasicMaterial({ color: 0x1a2226 }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -1.3;
  scene.add(sea);

  // Yol dokusu: yıpranmış koyu asfalt, yağ lekeleri, çatlaklar ve solmuş çizgiler.
  const tiles = Math.round(LEN / 22); // doku pist boyunca kaç kez tekrarlanacak
  const roadTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#2c2a2b';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1500; i++) { // asfalt pürüzü için küçük noktalar
      g.fillStyle = R() < 0.5 ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.14)';
      g.fillRect(R() * w, R() * h, 2, 2);
    }
    for (let i = 0; i < 5; i++) { // yağ lekeleri
      g.fillStyle = 'rgba(0,0,0,.28)';
      g.beginPath();
      g.ellipse(30 + R() * (w - 60), R() * h, 8 + R() * 18, 5 + R() * 12, R() * 3, 0, TAU);
      g.fill();
    }
    g.strokeStyle = 'rgba(0,0,0,.5)'; // çatlaklar
    g.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      let x = 30 + R() * (w - 60), y = R() * h;
      g.beginPath();
      g.moveTo(x, y);
      for (let j = 0; j < 4; j++) { x += (R() - 0.5) * 30; y += 8 + R() * 20; g.lineTo(x, y); }
      g.stroke();
    }
    g.fillStyle = 'rgba(214,206,190,.55)';
    g.fillRect(8, 0, 6, h);
    g.fillRect(w - 14, 0, 6, h);
    g.fillStyle = 'rgba(232,160,20,.6)';
    g.fillRect(w / 2 - 4, 0, 8, h * 0.5);
  });
  roadTex.wrapT = THREE.RepeatWrapping;
  roadTex.anisotropy = maxAniso;
  scene.add(new THREE.Mesh(ribbon(0, N, HALF_W, -HALF_W, 0.05, i => i / N * tiles), flatMat({ map: roadTex }, 2)));

  // Yolun iki yanındaki sarı-siyah tehlike şeritleri.
  const kerbTex = canvasTex(16, 64, (g, w, h) => {
    g.fillStyle = '#c98a0c';
    g.fillRect(0, 0, w, h / 2);
    g.fillStyle = '#17130f';
    g.fillRect(0, h / 2, w, h / 2);
  });
  kerbTex.wrapT = THREE.RepeatWrapping;
  kerbTex.anisotropy = maxAniso;
  const kerbMat = flatMat({ map: kerbTex }, 3);
  scene.add(new THREE.Mesh(ribbon(0, N, HALF_W + 1.5, HALF_W, 0.07, i => i / 4), kerbMat));
  scene.add(new THREE.Mesh(ribbon(0, N, -HALF_W, -HALF_W - 1.5, 0.07, i => i / 4), kerbMat));

  // Başlangıç çizgisi (damalı şerit).
  const chk = canvasTex(64, 16, g => {
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 2; y++) {
        g.fillStyle = (x + y) % 2 ? '#111' : '#fff';
        g.fillRect(x * 8, y * 8, 8, 8);
      }
    }
  });
  chk.magFilter = THREE.NearestFilter;
  chk.wrapS = THREE.RepeatWrapping;
  chk.repeat.set(1.5, 1);
  scene.add(new THREE.Mesh(ribbon(0, 2, HALF_W, -HALF_W, 0.1, i => i / 2), flatMat({ map: chk }, 5)));

  // Bariyer: pistin iki yanında, kartların daha öteye geçemediği paslı sac duvar.
  // Doku: pas lekeli metal levhalar, aralarında birleşim yeri ve perçinler.
  const fenceTex = canvasTex(128, 64, (g, w, h) => {
    g.fillStyle = '#5a3a26';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      g.fillStyle = R() < 0.5 ? 'rgba(170,80,30,.25)' : 'rgba(20,12,8,.25)';
      const s = 2 + R() * 9;
      g.fillRect(R() * w, R() * h, s, s * (0.5 + R()));
    }
    for (let i = 0; i < 6; i++) { // aşağı akan pas izleri
      g.fillStyle = 'rgba(140,60,20,.35)';
      g.fillRect(R() * w, 8, 2 + R() * 3, 20 + R() * 36);
    }
    g.fillStyle = 'rgba(0,0,0,.55)'; // levhaların birleşim yeri
    g.fillRect(0, 0, 3, h);
    g.fillRect(w / 2, 0, 3, h);
    g.fillStyle = 'rgba(0,0,0,.45)'; // üst kenar
    g.fillRect(0, 0, w, 5);
    g.fillStyle = '#2a1d15';         // perçinler
    for (const x of [8, w / 2 - 6, w / 2 + 10, w - 8]) {
      g.fillRect(x, 10, 3, 3);
      g.fillRect(x, h - 12, 3, 3);
    }
  });
  fenceTex.wrapS = THREE.RepeatWrapping;

  function fence(off, h) {
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const j = i % N;
      const x = px[j] + nx[j] * off;
      const z = pz[j] + nz[j] * off;
      pos.push(x, 0, z, x, h, z);
      uv.push(i / 8, 0, i / 8, 1);
      if (i < N) {
        const k = i * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }
  const fenceMat = new THREE.MeshBasicMaterial({ map: fenceTex, side: THREE.DoubleSide });
  scene.add(new THREE.Mesh(fence(WALL + 1.2, 2.2), fenceMat));
  scene.add(new THREE.Mesh(fence(-WALL - 1.2, 2.2), fenceMat));

  // Başlangıç takı: iki direk ve üstünde oyunun adının yazdığı pano.
  // Panodaki yazıyı değiştirmek için aşağıdaki 'FIRTINA KART' yazısını değiştir.
  (function () {
    const g = new THREE.Group();
    g.position.set(px[0], 0, pz[0]);
    g.rotation.y = hd[0];
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x3a2a20 });
    const w = HALF_W + 3;

    [-w, w].forEach(x => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 10, 10), poleMat);
      pole.position.set(x, 5, 0);
      g.add(pole);
    });
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w * 2 + 1, 2.6, 0.6), poleMat);
    bar.position.y = 9.2;
    g.add(bar);

    const t = canvasTex(1024, 128, (c, W, H) => {
      c.fillStyle = '#17130f';
      c.fillRect(0, 0, W, H);
      for (let x = -4; x < 12; x++) { // iki uçtaki sarı-siyah çapraz tehlike şeridi
        c.fillStyle = '#d99a0e';
        for (const ox of [0, W - 192]) {
          c.beginPath();
          c.moveTo(ox + x * 32, H);
          c.lineTo(ox + x * 32 + 16, H);
          c.lineTo(ox + x * 32 + 16 + H, 0);
          c.lineTo(ox + x * 32 + H, 0);
          c.closePath();
          c.save();
          c.beginPath();
          c.rect(ox, 0, 192, H);
          c.clip();
          c.beginPath();
          c.moveTo(ox + x * 32, H);
          c.lineTo(ox + x * 32 + 16, H);
          c.lineTo(ox + x * 32 + 16 + H, 0);
          c.lineTo(ox + x * 32 + H, 0);
          c.fill();
          c.restore();
        }
      }
      c.fillStyle = '#e8590c';
      c.font = 'italic 900 84px "Exo 2","Trebuchet MS",sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('FIRTINA KART', W / 2, H / 2 + 4);
    });
    t.anisotropy = maxAniso;
    const bannerMat = new THREE.MeshBasicMaterial({ map: t });

    // Yazı hem önden hem arkadan okunabilsin diye iki ayrı yüz.
    const front = new THREE.Mesh(new THREE.PlaneGeometry(w * 2 + 0.6, 2.3), bannerMat);
    front.position.set(0, 9.2, -0.32);
    front.rotation.y = Math.PI;
    g.add(front);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(w * 2 + 0.6, 2.3), bannerMat);
    back.position.set(0, 9.2, 0.32);
    g.add(back);

    scene.add(g);
  })();


  /* ===================================================================
     5. HIZLANDIRMA PEDLERİ VE EŞYA KUTULARI
     =================================================================== */

  // Ped dokusu: koyu metal zemin üzerinde ileriyi gösteren kızgın turuncu oklar.
  const padTex = canvasTex(64, 64, g => {
    g.fillStyle = '#2a1a12';
    g.fillRect(0, 0, 64, 64);
    g.strokeStyle = '#ff7a1a';
    g.lineWidth = 9;
    g.lineJoin = 'miter';
    for (let r = 0; r < 2; r++) {
      const y = r * 32;
      g.beginPath();
      g.moveTo(8, y + 26);
      g.lineTo(32, y + 8);
      g.lineTo(56, y + 26);
      g.stroke();
    }
  });
  padTex.wrapT = THREE.RepeatWrapping;
  const padMat = flatMat({ map: padTex }, 6);

  // Pedlerin yeri: [pist parçası numarası, yolun ortasından sağa/sola kayma].
  // Yeni ped eklemek için listeye bir satır eklemen yeter.
  const pads = [[45, 3.5], [215, -3.5], [395, 0], [560, 3]].map(([i, lane]) => {
    scene.add(new THREE.Mesh(ribbon(i, i + 4, lane + 3, lane - 3, 0.11, k => (k - i) / 2), padMat));
    return { i, lane };
  });

  // Eşya kutuları: havada dönen, kenarları kızgın parlayan ikmal sandıkları.
  // Üstünden geçen kart eşya kazanır.
  const crateTex = canvasTex(64, 64, g => {
    g.fillStyle = '#4a3324';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = 'rgba(160,80,30,.35)';
    for (let i = 0; i < 40; i++) g.fillRect(R() * 64, R() * 64, 2 + R() * 6, 2 + R() * 6);
    g.strokeStyle = '#ffffff'; // kenar çerçevesi (rengi malzemeden gelir, yanıp söner)
    g.lineWidth = 6;
    g.strokeRect(3, 3, 58, 58);
    g.beginPath();             // çapraz destek
    g.moveTo(6, 6); g.lineTo(58, 58);
    g.stroke();
  });
  const gemMat = new THREE.MeshPhongMaterial({ color: 0xffffff, map: crateTex, emissive: 0x333333, emissiveMap: crateTex, shininess: 20 });
  const gemGeo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
  const boxes = [];
  // Dört ayrı yerde, yan yana dörder kutu.
  [110, 290, 450, 585].forEach(i => {
    [-5.4, -1.8, 1.8, 5.4].forEach(l => {
      const m = new THREE.Mesh(gemGeo, gemMat);
      m.position.set(px[i] + nx[i] * l, 1.5, pz[i] + nz[i] * l);
      scene.add(m);
      boxes.push({ x: m.position.x, z: m.position.z, m, t: 0 }); // t: yeniden belirmesine kalan süre
    });
  });


  /* ===================================================================
     6. MANZARA: ÖLÜ AĞAÇLAR, HURDA, KAYALIKLAR, DUMAN, FABRİKA BACALARI
     =================================================================== */

  // Verilen noktanın piste en yakın uzaklığı (ağaçlar yola dikilmesin diye).
  function trackDist(x, z) {
    let best = 1e12;
    for (let i = 0; i < N; i += 2) {
      const dx = x - px[i], dz = z - pz[i];
      const q = dx * dx + dz * dz;
      if (q < best) best = q;
    }
    return Math.sqrt(best);
  }

  (function () {
    // 300 süs (ölü ağaç, hurda yığını, varil) için adada rastgele yer seç, piste çok yakın olanları atla.
    const spots = [];
    let guard = 0;
    while (spots.length < 300 && guard++ < 6000) {
      const a = R() * TAU;
      const r = Math.sqrt(R()) * (ISLAND - 12);
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      if (trackDist(x, z) > WALL + 5) spots.push([x, z, 0.7 + R() * 0.9, R()]); // [x, z, boyut, rastgele]
    }
    const pines = spots.filter(s => s[3] < 0.55);  // ölü, kurumuş ağaçlar (ince koni)
    const leafy = spots.filter(s => s[3] >= 0.55); // hurda ve kaya yığınları

    const d = new THREE.Object3D();
    const col = new THREE.Color();

    // InstancedMesh: aynı şekli yüzlerce kez çizmenin hızlı yolu.
    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.35, 0.5, 3, 6),
      new THREE.MeshLambertMaterial({ color: 0x241a14 }),
      spots.length
    );
    spots.forEach((s, i) => {
      d.position.set(s[0], 1.5 * s[2], s[1]);
      d.scale.setScalar(s[2]);
      d.rotation.set(0, 0, 0);
      d.updateMatrix();
      trunks.setMatrixAt(i, d.matrix);
    });
    scene.add(trunks);

    const pineMesh = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.9, 8, 5),
      new THREE.MeshPhongMaterial({ color: 0xffffff, flatShading: true, shininess: 0 }),
      pines.length
    );
    pines.forEach((s, i) => {
      d.position.set(s[0], 5.6 * s[2], s[1]);
      d.scale.setScalar(s[2]);
      d.rotation.set(0, s[3] * 9, 0);
      d.updateMatrix();
      pineMesh.setMatrixAt(i, d.matrix);
      pineMesh.setColorAt(i, col.setHSL(0.06, 0.25, 0.1 + s[2] * 0.03));
    });
    scene.add(pineMesh);

    const leafMesh = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(2.6, 0),
      new THREE.MeshPhongMaterial({ color: 0xffffff, flatShading: true, shininess: 0 }),
      leafy.length
    );
    leafy.forEach((s, i) => {
      d.position.set(s[0], 0.6 * s[2], s[1]);
      d.scale.set(s[2] * 1.3, s[2] * 0.7, s[2]);
      d.rotation.set(s[3] * 5, s[3] * 9, 0);
      d.updateMatrix();
      leafMesh.setMatrixAt(i, d.matrix);
      // Bazıları pas kırmızısı hurda, bazıları kömür grisi kaya.
      leafMesh.setColorAt(i, s[3] > 0.8 ? col.setHSL(0.05, 0.55, 0.22) : col.setHSL(0.07, 0.12, 0.16 + s[2] * 0.04));
    });
    scene.add(leafMesh);

    // Varil yığınları: pistin yakınına ama bariyerin dışına konan paslı variller.
    const barrelSpots = [];
    for (let i = 0; i < N; i += 23) {
      const side = (i / 23) % 2 ? 1 : -1;
      const off = WALL + 4 + R() * 3;
      for (let b = 0; b < 3; b++) {
        barrelSpots.push([px[i] + nx[i] * side * (off + b * 1.3), pz[i] + nz[i] * side * (off + b * 1.3) + (R() - 0.5) * 1.5, R()]);
      }
    }
    const barrels = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.6, 0.6, 1.6, 10),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      barrelSpots.length
    );
    barrelSpots.forEach((b, i) => {
      d.position.set(b[0], 0.8, b[1]);
      d.scale.setScalar(1);
      d.rotation.set(0, 0, b[2] > 0.85 ? Math.PI / 2 : 0); // bazıları devrilmiş
      if (b[2] > 0.85) d.position.y = 0.6;
      d.updateMatrix();
      barrels.setMatrixAt(i, d.matrix);
      barrels.setColorAt(i, b[2] < 0.4 ? col.setHex(0x6b2a14) : b[2] < 0.7 ? col.setHex(0x8a5a10) : col.setHex(0x2c3a30));
    });
    scene.add(barrels);

    // Uzaktaki kara kayalıklar (eski karlı dağların yerinde, tepeleri kor gibi kızıl).
    const rockMat = new THREE.MeshPhongMaterial({ color: 0x1e1816, flatShading: true, shininess: 0 });
    const snowMat = new THREE.MeshPhongMaterial({ color: 0x5a1e0e, emissive: 0x2a0800, flatShading: true, shininess: 0 });
    for (let i = 0; i < 13; i++) {
      const a = i / 13 * TAU + R() * 0.3;
      const r = 760 + R() * 380;
      const h = 150 + R() * 170;
      const w = 140 + R() * 120;
      const m = new THREE.Mesh(new THREE.ConeGeometry(w, h, 6), rockMat);
      m.position.set(Math.sin(a) * r, h / 2 - 3, Math.cos(a) * r);
      m.rotation.y = R() * 3;
      scene.add(m);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(w * 0.34, h * 0.34, 6), snowMat);
      cap.position.set(m.position.x, h * 0.83 - 2, m.position.z);
      cap.rotation.y = m.rotation.y;
      scene.add(cap);
    }
  })();

  // Duman bulutları: yan yana birkaç koyu gri toptan oluşur, yavaşça kayarlar.
  const clouds = [];
  (function () {
    const cloudMat = new THREE.MeshBasicMaterial({ color: 0x2a2220, fog: false });
    const cloudGeo = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 16; i++) {
      const g = new THREE.Group();
      const n = 3 + Math.floor(R() * 3);
      for (let j = 0; j < n; j++) {
        const s = new THREE.Mesh(cloudGeo, cloudMat);
        s.position.set(j * 20 - n * 10 + R() * 8, R() * 6, R() * 10);
        s.scale.set(18 + R() * 12, 9 + R() * 6, 13 + R() * 8);
        g.add(s);
      }
      g.position.set((R() * 2 - 1) * 1100, 120 + R() * 110, (R() * 2 - 1) * 1100);
      scene.add(g);
      clouds.push(g);
    }
  })();

  // Fabrika bacaları: [x, z, yükseklik]. Tepelerinden sürekli koyu duman tüter,
  // dibinde kızgın bir ateş ağzı parlar. Sadece süs.
  const stacks = []; // her bacanın duman topları
  (function () {
    const stackMat = new THREE.MeshLambertMaterial({ color: 0x3a2a22 });
    const bandMat = new THREE.MeshBasicMaterial({ color: 0xb8420e });
    const smokeMat = new THREE.MeshBasicMaterial({ color: 0x1c1816, transparent: true, opacity: 0.75, depthWrite: false });
    const smokeGeo = new THREE.IcosahedronGeometry(1, 1);
    [[-40, 30, 70], [120, -20, 90], [-200, -40, 60], [260, 160, 80], [-280, 200, 75]].forEach(([x, z, h]) => {
      const g = new THREE.Group();
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(4, 6, h, 12), stackMat);
      tube.position.y = h / 2;
      g.add(tube);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(4.3, 4.3, 2, 12), bandMat); // tepedeki kızgın halka
      band.position.y = h - 4;
      g.add(band);
      g.position.set(x, 0, z);
      scene.add(g);
      const puffs = [];
      for (let i = 0; i < 8; i++) {
        const m = new THREE.Mesh(smokeGeo, smokeMat);
        g.add(m);
        puffs.push({ m, t: i / 8 });
      }
      stacks.push({ h, puffs });
    });
  })();


  /* ===================================================================
     7. KART MODELİ (ARABA + SÜRÜCÜ)
     ===================================================================
     Araba ve sürücü, kutu / silindir / küre gibi basit şekillerin üst üste
     konmasıyla yapılıyor. Kendi karakterini veya arabanı tasarlamak için
     değiştireceğin yer burası.
       col : ana renk (gövde ve kask)
       acc : ikinci renk (kanatlar, sürücünün gövdesi, jant)
     add(şekil, malzeme, x, y, z) -> şekli arabaya ekler.
       x: sağ-sol, y: yukarı-aşağı, z: ön-arka (artı z = arabanın önü)
     =================================================================== */

  function makeKart(col, acc) {
    const root = new THREE.Group(); // kartın tamamı (konum ve yön buna verilir)
    const body = new THREE.Group(); // gövde (zıplama ve yana yatma buna verilir)
    root.add(body);

    const M = c => new THREE.MeshLambertMaterial({ color: c });
    const mainMat = M(col), accMat = M(acc), dark = M(0x262a33), tire = M(0x14161b);

    const add = (geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      body.add(m);
      return m;
    };

    // --- Araba ---
    add(new THREE.BoxGeometry(1.5, 0.42, 2.5), mainMat, 0, 0.52, 0);        // ana gövde
    add(new THREE.BoxGeometry(1.0, 0.3, 0.9), mainMat, 0, 0.47, 1.5);       // burun
    add(new THREE.BoxGeometry(1.8, 0.12, 0.34), accMat, 0, 0.36, 2.0);      // ön kanat
    add(new THREE.BoxGeometry(0.3, 0.3, 1.1), accMat, 0.88, 0.5, 0.05);     // sağ yan parça
    add(new THREE.BoxGeometry(0.3, 0.3, 1.1), accMat, -0.88, 0.5, 0.05);    // sol yan parça
    add(new THREE.BoxGeometry(0.95, 0.8, 0.22), dark, 0, 1.05, -0.72);      // koltuk arkalığı
    add(new THREE.BoxGeometry(0.9, 0.42, 0.5), dark, 0, 0.9, -1.08);        // motor
    add(new THREE.BoxGeometry(1.9, 0.1, 0.52), accMat, 0, 1.5, -1.32);      // arka kanat
    add(new THREE.BoxGeometry(0.1, 0.62, 0.1), dark, 0.62, 1.18, -1.32);    // arka kanat ayağı (sağ)
    add(new THREE.BoxGeometry(0.1, 0.62, 0.1), dark, -0.62, 1.18, -1.32);   // arka kanat ayağı (sol)

    // --- Zırh ---
    const steel = M(0x4a4440), rust = M(0x6b3418);
    add(new THREE.BoxGeometry(2.1, 0.34, 0.22), steel, 0, 0.5, 2.3);        // önde koçbaşı (çarpma tamponu)
    add(new THREE.BoxGeometry(0.14, 0.5, 0.14), steel, 0.6, 0.62, 2.18);    // koçbaşı dikmesi (sağ)
    add(new THREE.BoxGeometry(0.14, 0.5, 0.14), steel, -0.6, 0.62, 2.18);   // koçbaşı dikmesi (sol)
    add(new THREE.BoxGeometry(0.08, 0.5, 1.6), rust, 1.06, 0.62, 0.05);     // yan zırh plakası (sağ)
    add(new THREE.BoxGeometry(0.08, 0.5, 1.6), rust, -1.06, 0.62, 0.05);    // yan zırh plakası (sol)
    add(new THREE.BoxGeometry(1.1, 0.08, 0.7), steel, 0, 0.78, 1.0);        // kaput plakası
    add(new THREE.BoxGeometry(0.16, 0.16, 0.5), dark, 0.28, 0.98, -1.4);    // egzoz (sağ)
    add(new THREE.BoxGeometry(0.16, 0.16, 0.5), dark, -0.28, 0.98, -1.4);   // egzoz (sol)

    // --- Sürücü ---
    add(new THREE.CylinderGeometry(0.3, 0.37, 0.66, 8), accMat, 0, 1.06, -0.3); // gövde
    add(new THREE.SphereGeometry(0.39, 12, 10), mainMat, 0, 1.7, -0.3);         // kask
    add(new THREE.BoxGeometry(0.54, 0.17, 0.3), dark, 0, 1.72, -0.03);          // vizör (gözlük)
    add(new THREE.BoxGeometry(0.09, 0.2, 0.56), accMat, 0, 2.08, -0.34);        // kaskın üstündeki ibik

    // --- Tekerlekler ---
    const wheelGeo = new THREE.CylinderGeometry(0.44, 0.44, 0.4, 14);
    wheelGeo.rotateZ(Math.PI / 2);
    const hubGeo = new THREE.BoxGeometry(0.43, 0.34, 0.34); // jant (dönüşü belli olsun diye köşeli)
    const wheels = [];  // dördü de döner
    const pivots = [];  // sadece öndekiler direksiyonla sağa sola çevrilir
    // [x, z, ön tekerlek mi?]
    [[0.96, 1.05, 1], [-0.96, 1.05, 1], [1, -0.95, 0], [-1, -0.95, 0]].forEach(([x, z, isFront]) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.44, z);
      body.add(pivot);
      const w = new THREE.Mesh(wheelGeo, tire);
      pivot.add(w);
      w.add(new THREE.Mesh(hubGeo, accMat));
      wheels.push(w);
      if (isFront) pivots.push(pivot);
    });

    // Turbo alevi: arkadaki iki turuncu koni. Sadece turbo varken görünür.
    const flameGeo = new THREE.ConeGeometry(0.26, 1.4, 8);
    flameGeo.rotateX(-Math.PI / 2);
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa21f });
    const flames = [0.34, -0.34].map(x => {
      const f = new THREE.Mesh(flameGeo, flameMat);
      f.position.set(x, 0.86, -2.0);
      f.visible = false;
      body.add(f);
      return f;
    });

    // Kalkan: kartı saran yarı saydam mavi küre. Sadece kalkan varken görünür.
    const shield = new THREE.Mesh(
      new THREE.SphereGeometry(2.2, 18, 12),
      new THREE.MeshBasicMaterial({ color: 0x6fe3ff, transparent: true, opacity: 0.3, depthWrite: false })
    );
    shield.position.y = 0.9;
    shield.visible = false;
    root.add(shield);

    // Kartın altındaki yuvarlak gölge.
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1.6, 16),
      new THREE.MeshBasicMaterial({
        color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8
      })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.13;
    shadow.scale.y = 1.35;
    root.add(shadow);

    // Gövdedeki bütün malzemeler: hasar alınca kararıp kızarmaları için saklanır.
    const mats = [];
    body.traverse(o => { if (o.material && o.material.color && !mats.includes(o.material) && o.material !== flameMat) mats.push(o.material); });
    mats.forEach(mt => { mt.userData.base = mt.color.getHex(); });

    return { root, body, wheels, pivots, flames, shield, mats };
  }


  /* ===================================================================
     8. PARÇACIKLAR (KIVILCIM, DUMAN, PATLAMA)
     ===================================================================
     360 küçük küp önceden hazırlanır. Gerektiğinde sıradaki küp alınır,
     bir yere konur, kısa süre uçup solar. Sonra tekrar kullanılır.
     =================================================================== */

  const PN = 360;
  const parts = [];
  let partIndex = 0;

  (function () {
    const g = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < PN; i++) {
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ transparent: true }));
      m.visible = false;
      scene.add(m);
      parts.push({ m, life: 0, max: 1, vx: 0, vy: 0, vz: 0, size: 1, grow: 0, g: 0 });
    }
  })();

  // Bir parçacık fırlatır.
  //   x,y,z    : çıkış yeri          vx,vy,vz : hızı
  //   color    : rengi               life     : kaç saniye yaşayacağı
  //   size     : boyutu              grow     : zamanla ne kadar büyüyeceği
  //   gravity  : yer çekimi (0 ise havada süzülür)
  function emit(x, y, z, vx, vy, vz, color, life, size, grow, gravity) {
    const p = parts[partIndex];
    partIndex = (partIndex + 1) % PN;
    p.m.position.set(x, y, z);
    p.m.material.color.setHex(color);
    p.life = p.max = life;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.size = size;
    p.grow = grow || 0;
    p.g = gravity || 0;
    p.m.visible = true;
  }

  // Her karede parçacıkları hareket ettirir ve soldurur.
  function updateParts(dt) {
    for (const p of parts) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.m.visible = false; continue; }
      p.vy -= p.g * dt;
      const q = p.m.position;
      q.x += p.vx * dt;
      q.y += p.vy * dt;
      q.z += p.vz * dt;
      if (q.y < 0.1) { q.y = 0.1; p.vy *= -0.4; } // yere çarpınca hafifçe seker
      const k = p.life / p.max; // 1'den 0'a doğru azalır
      p.m.scale.setScalar(p.size * (1 + p.grow * (1 - k)));
      p.m.material.opacity = k;
      p.m.rotation.x += dt * 6;
      p.m.rotation.y += dt * 4;
    }
  }

  // Küçük patlama (roket çarpınca): her yöne saçılan 18 turuncu-sarı parçacık.
  function explode(x, z) {
    for (let i = 0; i < 18; i++) {
      emit(x, 1, z,
        (Math.random() - 0.5) * 22, 3 + Math.random() * 9, (Math.random() - 0.5) * 22,
        i % 2 ? 0xff7a1a : 0xffe14a, 0.55, 0.55, 1.2, 18);
    }
  }

  // Büyük patlama (kart parçalanınca): ateş topu, kara duman ve havaya uçan hurda parçaları.
  function blast(x, z) {
    for (let i = 0; i < 22; i++) { // ateş
      emit(x, 1.2, z,
        (Math.random() - 0.5) * 26, 4 + Math.random() * 12, (Math.random() - 0.5) * 26,
        i % 3 ? 0xff6a10 : 0xffd23a, 0.6, 0.55, 1.1, 14);
    }
    for (let i = 0; i < 14; i++) { // kara duman
      emit(x + (Math.random() - 0.5) * 2, 1.5, z + (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 6, 3 + Math.random() * 4, (Math.random() - 0.5) * 6,
        0x1a1512, 1.3, 0.55, 1.8, 0);
    }
    for (let i = 0; i < 10; i++) { // hurda parçaları
      emit(x, 1, z,
        (Math.random() - 0.5) * 18, 8 + Math.random() * 10, (Math.random() - 0.5) * 18,
        i % 2 ? 0x3a3330 : 0x6b3418, 1.4, 0.35, 0, 30);
    }
  }


  /* ===================================================================
     9. SES
     ===================================================================
     Ses dosyası yok; sesler tarayıcının ses üreticisiyle anlık üretiliyor.
     Tarayıcılar, kullanıcı bir yere tıklamadan ses çalmaya izin vermez;
     bu yüzden ses "YARIŞA BAŞLA" tuşuna basınca açılır.
     =================================================================== */

  let AC = null;      // ses sistemi
  let master;         // genel ses düzeyi
  let engOsc, engGain; // motor sesi (sürekli çalan ton) ve onun ses düzeyi
  let muted = false;

  function initAudio() {
    if (AC) return;
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)();
      master = AC.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(AC.destination);

      // Motor sesi: hıza göre incelip kalınlaşan testere dişi dalga.
      engOsc = AC.createOscillator();
      engOsc.type = 'sawtooth';
      engOsc.frequency.value = 60;
      const filter = AC.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 520;
      engGain = AC.createGain();
      engGain.gain.value = 0;
      engOsc.connect(filter);
      filter.connect(engGain);
      engGain.connect(master);
      engOsc.start();
    } catch (e) {
      AC = null; // ses açılamazsa oyun sessiz devam eder
    }
  }

  // Kısa bir "bip" sesi çalar.
  //   freq: ton (büyük sayı = ince ses)   dur: süre (saniye)
  //   type: ses rengi                     vol: ses düzeyi
  //   slide: ses çalarken tonun ne kadar kayacağı (artı = incelir, eksi = kalınlaşır)
  function tone(freq, dur, type, vol, slide) {
    if (!AC || muted) return;
    try {
      const t = AC.currentTime;
      const o = AC.createOscillator();
      const g = AC.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
      g.gain.setValueAtTime(vol || 0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g);
      g.connect(master);
      o.start(t);
      o.stop(t + dur + 0.02);
    } catch (e) { /* ses hatası oyunu durdurmasın */ }
  }

  function toggleMute() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.5;
  }


  /* ===================================================================
     10. YARIŞÇILAR
     =================================================================== */

  // Oyuncunun menüde seçebileceği renkler. n: adı, c: renk kodu.
  const PCOLS = [
    { n: 'Kan kırmızısı', c: 0xa3261b },
    { n: 'Çelik mavisi', c: 0x34557f },
    { n: 'Asker yeşili', c: 0x55652a },
    { n: 'Tehlike sarısı', c: 0xc99a12 }
  ];

  // Rakipler: [ad, ana renk, ikinci renk]. Adları ve renkleri buradan değiştirebilirsin.
  const AIS = [
    ['Bora', 0x5e2d6e, 0xb88a1c],
    ['Ada', 0x8a2f4a, 0x9a9089],
    ['Poyraz', 0x1f6b63, 0x17130f],
    ['Defne', 0xb35a12, 0x262220],
    ['Çınar', 0x5a3a26, 0x8a7a5c],
    ['Lodos', 0x8e8a84, 0x8f1d14],
    ['Nil', 0x23305e, 0x5f8a8f]
  ];

  const BASE_V = 38; // en yüksek hız (ekranda 3.6 ile çarpılıp km/sa olarak gösterilir)

  // Zırh ve hasar ayarları. Oyunu daha sert ya da daha affedici yapmak için bunlarla oyna.
  const MAX_HP = 100;      // tam zırh
  const ROCKET_DMG = 45;   // roket isabeti
  const OIL_DMG = 12;      // yağa basmak
  const RAM_MIN = 6;       // bu hızdan yavaş çarpışmalar hasar vermez
  const RAM_DMG = 2.2;     // çarpışma hasarı (hız farkı başına)
  const WALL_MIN = 8;      // duvara bu hızdan yavaş sürtünmek hasar vermez
  const WALL_DMG = 1.1;    // duvar hasarı
  const REPAIR = 50;       // tamir eşyasının geri verdiği zırh
  const WRECK_TIME = 2.6;  // parçalanan kartın yeniden doğmasına kadar geçen süre
  const GHOST_TIME = 2.2;  // yeniden doğunca dokunulmazlık süresi

  // Yeni bir yarışçı oluşturur. Aşağıdaki liste bir kartın tuttuğu bütün bilgilerdir.
  function newKart(isPlayer, name, col, acc) {
    const m = makeKart(col, acc);
    scene.add(m.root);
    return {
      isPlayer, name, col, m,
      x: 0, z: 0,          // konum
      h: 0,                // kartın baktığı yön (açı)
      va: 0,               // kartın gerçekte gittiği yön (driftte bakış yönünden farklı olur)
      speed: 0,            // hız
      idx: 0,              // pistin kaçıncı parçasında
      lap: 0,              // kaçıncı turda
      lat: 0,              // yolun ortasından ne kadar yanda
      drift: 0,            // drift yönü: 1 sol, -1 sağ, 0 drift yok
      chargeT: 0,          // drift ne kadar süredir sürüyor
      charge: 0,           // turbo seviyesi: 0 yok, 1 sarı kıvılcım, 2 pembe kıvılcım
      driftReady: true,    // drift tuşu bırakılıp yeniden basıldı mı
      boost: 0,            // kalan turbo süresi
      spin: 0,             // kalan savrulma süresi (vurulunca)
      spinA: 0,            // savrulurken dönme açısı
      shield: 0,           // kalan kalkan süresi
      item: null,          // eldeki eşya
      roul: 0,             // eşya çarkının kalan dönme süresi
      itemDelay: 0,        // rakibin eşyayı kullanmadan önce bekleyeceği süre
      hopY: 0, hopV: 0,    // drift başlarken küçük zıplama (yükseklik ve hız)
      roll: 0,             // gövdenin yana yatması
      steerS: 0,           // yumuşatılmış direksiyon (-1 ile 1 arası)
      finished: false, finishTime: 0, finishOrder: 0,
      rank: 1,             // yarıştaki sırası
      vmax: BASE_V,        // şu anki hız sınırı
      accel: 16,           // hızlanma gücü
      turn: isPlayer ? 1.9 : 2.3, // dönüş keskinliği
      lane: 0, laneT: 0,   // rakibin tuttuğu şerit ve şerit değiştirme sayacı
      skill: 1,            // rakibin becerisi (hızını belirler)
      stuck: 0,            // rakip ne kadar süredir takılı
      prog: 0,             // yarışta kat ettiği toplam yol (sıralama için)
      padT: 0,             // pedden yeni geçtiyse bekleme süresi
      hp: MAX_HP,          // kalan zırh (0 olunca kart parçalanır)
      wreck: 0,            // parçalandıysa yeniden doğmasına kalan süre
      ghost: 0,            // yeniden doğduktan sonra dokunulmazlık süresi (yanıp söner)
      bumpT: 0,            // çarpışma hasarından sonra bekleme (aynı çarpışma iki kez sayılmasın)
      wallT: 0,            // duvar hasarından sonra bekleme
      hurtT: 0,            // hasar alınca kısa süre kırmızı parlama
      kills: 0,            // bu yarışta parçaladığı rakip sayısı
      charA: -1            // gövdenin şu anki kararma miktarı (gereksiz yere yeniden boyamamak için)
    };
  }

  let pcol = 0; // seçili oyuncu rengi (PCOLS listesindeki sıra)
  let diff = 1; // zorluk: 0 kolay, 1 orta, 2 zor

  const karts = AIS.map(a => newKart(false, a[0], a[1], a[2]));
  const player = newKart(true, 'Sen', PCOLS[0].c, 0x2e2a26);
  karts.push(player);
  let playerColApplied = 0;

  // Kartı bulunduğu yerde yolun ortasına, doğru yöne bakar şekilde geri koyar (R tuşu).
  function resetKart(k) {
    k.x = px[k.idx];
    k.z = pz[k.idx];
    k.h = k.va = hd[k.idx];
    k.speed = 0;
    k.drift = 0;
    k.chargeT = 0;
    k.charge = 0;
    k.spin = 0;
    k.spinA = 0;
    k.stuck = 0;
    k.boost = 0;
  }

  // Bütün kartları başlangıç çizgisinin arkasına ikişerli sıralar. Oyuncu en arkadan başlar.
  function placeGrid() {
    // Zorluğa göre rakiplerin beceri aralığı [en yavaş, en hızlı]. 1.00 = oyuncuyla aynı hız.
    const skillRange = [[0.80, 0.90], [0.87, 0.96], [0.93, 1.01]][diff];
    const order = [0, 1, 2, 3, 4, 5, 6].sort(() => Math.random() - 0.5); // becerileri rastgele dağıt

    karts.forEach((k, s) => {
      const row = Math.floor(s / 2);
      const side = s % 2 ? -1 : 1;
      const j = (N - 6 - row * 5 - (s % 2) * 2 + N) % N;
      Object.assign(k, {
        idx: j, lap: 0, lat: 0, speed: 0, drift: 0, chargeT: 0, charge: 0, driftReady: true,
        boost: 0, spin: 0, spinA: 0, shield: 0, item: null, roul: 0, itemDelay: 0,
        hopY: 0, hopV: 0, steerS: 0, finished: false, finishTime: 0, finishOrder: 0,
        stuck: 0, padT: 0, lane: 3.4 * side, laneT: 2 + Math.random() * 3,
        hp: MAX_HP, wreck: 0, ghost: 0, bumpT: 0, wallT: 0, hurtT: 0, kills: 0
      });
      k.x = px[j] + nx[j] * 3.4 * side;
      k.z = pz[j] + nz[j] * 3.4 * side;
      k.h = k.va = hd[j];
      if (!k.isPlayer) k.skill = skillRange[0] + (skillRange[1] - skillRange[0]) * (order[s] / 6);
    });
  }

  // Bir nesnenin pistin neresinde olduğunu bulur: en yakın parça (idx), yoldan
  // yana kayma (lat) ve başlangıç çizgisinden geçtiyse tur sayısı (lap).
  // Hız için sadece son bilinen parçanın yakınlarına bakar.
  function trackPos(o) {
    let best = o.idx, bestDist = 1e12;
    for (let d = -8; d <= 16; d++) {
      const j = (o.idx + d + N) % N;
      const dx = o.x - px[j], dz = o.z - pz[j];
      const q = dx * dx + dz * dz;
      if (q < bestDist) { bestDist = q; best = j; }
    }
    const prev = o.idx;
    o.idx = best;
    if (prev > N * 0.75 && best < N * 0.25) o.lap++;      // çizgiyi ileri yönde geçti
    else if (prev < N * 0.25 && best > N * 0.75) o.lap--; // çizgiyi geri geri geçti
    o.lat = (o.x - px[best]) * nx[best] + (o.z - pz[best]) * nz[best];
  }


  /* ===================================================================
     11. KONTROLLER VE RAKİPLERİN YAPAY ZEKÂSI
     =================================================================== */

  const keys = {}; // o an basılı olan klavye tuşları
  const touch = { left: false, right: false, brake: false, drift: false, auto: false }; // dokunmatik tuşlar
  let wantItem = false; // oyuncu eşya tuşuna bastı mı
  let gasAt = 99;       // geri sayımda gaza basıldığı an (hızlı kalkış için)
  const NOIN = { steer: 0, gas: 0, brake: 0, drift: false }; // "hiçbir tuşa basılmıyor"

  // Tuş atamaları burada. e.code tuşun klavyedeki yeridir (KeyW = W tuşu gibi).
  addEventListener('keydown', e => {
    // Ok tuşları ve boşluk sayfayı kaydırmasın.
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code) && state !== 'menu') e.preventDefault();
    if (e.repeat) return;
    keys[e.code] = true;

    if (state === 'count' && (e.code === 'ArrowUp' || e.code === 'KeyW')) gasAt = countT;
    if (state === 'race') {
      if (e.code === 'KeyE' || e.code === 'KeyX' || e.code === 'KeyQ') wantItem = true; // eşya kullan
      if (e.code === 'KeyR') resetKart(player);                                          // piste dön
    }
    if (e.code === 'KeyM') toggleMute();
    if ((e.code === 'KeyP' || e.code === 'Escape') && (state === 'race' || state === 'count')) togglePause();
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  // Pencere arka plana geçerse tuşlar basılı kalmasın.
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  // Oyuncunun o anki isteğini okur: direksiyon, gaz, fren, drift.
  function playerInput() {
    const left = keys.ArrowLeft || keys.KeyA || touch.left;
    const right = keys.ArrowRight || keys.KeyD || touch.right;
    let steer = (left ? 1 : 0) - (right ? 1 : 0); // 1 sol, -1 sağ
    // Tuşa basılmıyorsa ve telefon eğme açıksa direksiyonu telefonun eğimi belirler.
    const tilting = !steer && tiltActive();
    if (tilting) steer = tilt.value;
    return {
      steer,
      tilt: tilting,
      gas: keys.ArrowUp || keys.KeyW || touch.auto,
      brake: keys.ArrowDown || keys.KeyS || touch.brake,
      drift: !!(keys.Space || keys.ShiftLeft || keys.ShiftRight || touch.drift)
    };
  }

  // Telefon ve tablette ekrana dokunmatik tuşlar çıkar, gaz otomatik basılır.
  const isTouch = window.matchMedia && matchMedia('(pointer: coarse)').matches;

  /* ---------- Telefonu eğerek direksiyon ----------
     Telefon yatay tutulur ve direksiyon gibi sağa sola eğilir.
     Tarayıcı telefonun duruşunu iki açıyla bildirir (beta ve gamma). Bu açılardan
     "yukarı yön telefona göre nerede" bilgisi hesaplanır; telefonun bir yanı
     diğerinden ne kadar yüksekteyse direksiyon o kadar kırılır.

     Önemli: tarayıcılar hareket sensörünü sadece güvenli (https) adreslerde açar.
     Bilgisayardaki dosyayı telefona kopyalayıp açınca ya da claude.ai sayfasında
     sensör çalışmaz; o durumda oyun kendiliğinden ekrandaki ok tuşlarına döner. */
  const TILT_FULL = 32;   // direksiyonun sonuna kadar kırılması için gereken eğim (derece). Küçültürsen daha hassas olur.
  const TILT_DEAD = 3;    // bu kadar küçük eğimler yok sayılır (el titremesi için)
  const TILT_CURVE = 1.6; // 1 = düz tepki; büyüdükçe küçük eğimler daha yumuşak, büyük eğimler yine tam dönüş
  const TILT_SMOOTH = 5;  // eğerek sürerken direksiyonun dönme hızı (tuşlarda 9). Küçültürsen daha yumuşak olur.

  const tilt = {
    want: isTouch,     // oyuncu eğerek sürmek istiyor mu (menüden seçilir)
    listening: false,  // sensör dinlenmeye başlandı mı
    on: false,         // sensörden en az bir veri geldi mi
    value: 0,          // direksiyon değeri: 1 tam sol, -1 tam sağ
    dir: 1,            // telefon hangi yana yatırılmış: 1 üst kenar solda, -1 üst kenar sağda
    lastT: 0           // son verinin geldiği an
  };
  try { if (localStorage.getItem('fk_steer') === 'btn') tilt.want = false; } catch (e) { /* geç */ }

  // Ekranın bildirdiği yöne göre ilk tahmin (asıl karar sensör verisinden çıkar).
  (function () {
    const a = (screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle : window.orientation;
    if (a === 270 || a === -90) tilt.dir = -1;
  })();

  // Sensörden her veri geldiğinde çalışır.
  function onOrient(e) {
    if (e.beta === null || e.gamma === null || e.beta === undefined) return;
    const b = e.beta * Math.PI / 180;
    const g = e.gamma * Math.PI / 180;
    // "Yukarı" yönünün telefona göre bileşenleri:
    const ux = -Math.cos(b) * Math.sin(g); // telefonun kısa kenarı boyunca
    const uy = Math.sin(b);                // telefonun uzun kenarı boyunca

    let s;
    if (window.innerWidth >= window.innerHeight) {
      // Yatay tutuş. Telefonun hangi yana yatırıldığını yer çekiminden anla.
      if (Math.abs(ux) > 0.25) tilt.dir = ux > 0 ? 1 : -1;
      s = -tilt.dir * uy;
    } else {
      s = ux; // dik tutuş (yatay çevrilmemişse de çalışsın)
    }
    const deg = Math.asin(clamp(s, -1, 1)) * 180 / Math.PI; // eğim açısı (derece)
    const a = Math.abs(deg);
    const x = a < TILT_DEAD ? 0 : Math.min(1, (a - TILT_DEAD) / (TILT_FULL - TILT_DEAD));
    tilt.value = Math.sign(deg) * Math.pow(x, TILT_CURVE);
    tilt.lastT = performance.now();
    if (!tilt.on) {
      tilt.on = true;
      applyTouchLayout(); // sensör çalışıyor: ok tuşlarını kaldır
    }
  }

  // Eğerek sürüş şu an kullanılabilir mi? (isteniyor, veri geliyor ve veri taze)
  function tiltActive() {
    return tilt.want && tilt.on && performance.now() - tilt.lastT < 600;
  }

  // Sensörü açar. iPhone izin penceresi gösterir; bu yüzden bir tuşa basıldığı anda çağrılmalı.
  function enableTilt() {
    if (!tilt.want || tilt.listening) return;
    const D = window.DeviceOrientationEvent;
    if (!D) return;
    const listen = () => {
      addEventListener('deviceorientation', onOrient);
      tilt.listening = true;
    };
    if (typeof D.requestPermission === 'function') {
      D.requestPermission().then(r => { if (r === 'granted') listen(); }).catch(() => { /* izin verilmedi: tuşlarla devam */ });
    } else {
      listen();
    }
  }

  // Dokunmatik tuşların düzeni: eğerek sürülüyorsa ok tuşları gizlenir ve
  // FREN sol başparmağa geçer; tuşlarla sürülüyorsa oklar solda, FREN sağda durur.
  function applyTouchLayout() {
    const useTilt = tilt.want && tilt.on;
    $('tL').hidden = useTilt;
    $('tR').hidden = useTilt;
    const groups = $('touch').querySelectorAll('.grp');
    (useTilt ? groups[0] : groups[1]).prepend($('tB'));
    $('tB').classList.toggle('sm', !useTilt);
    $('tilt').hidden = !useTilt;
  }

  // Telefonda tam ekrana geçip ekranı yataya kilitlemeyi dener. Her telefon ve
  // tarayıcı buna izin vermez; izin vermezse sessizce vazgeçilir.
  function goLandscape() {
    if (!isTouch) return;
    try {
      const el = document.documentElement;
      const p = el.requestFullscreen ? el.requestFullscreen() : null;
      const lock = () => {
        if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
      };
      if (p && p.then) p.then(lock).catch(() => {}); else lock();
    } catch (e) { /* geç */ }
    // Eğerek sürerken ekrana dokunulmadığı için ekran kararmasın.
    try {
      if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {});
    } catch (e) { /* geç */ }
  }

  // Telefon dik tutuluyorsa "yan çevir" uyarısı çıkar ve oyun bekler.
  let rotateBlock = false;
  function checkRotate() {
    rotateBlock = isTouch && state !== 'menu' && window.innerHeight > window.innerWidth;
    $('rotate').hidden = !rotateBlock;
  }
  function hold(id, key) {
    const el = $(id);
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      touch[key] = true;
      el.classList.add('on');
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => el.addEventListener(t, () => {
      touch[key] = false;
      el.classList.remove('on');
    }));
  }
  hold('tL', 'left');
  hold('tR', 'right');
  hold('tB', 'brake');
  hold('tD', 'drift');
  $('tI').addEventListener('pointerdown', e => { e.preventDefault(); wantItem = true; });
  if (isTouch) {
    $('itemKey').hidden = true; // telefonda "E" tuşu etiketi gereksiz
    // Telefonlarda akıcı kalsın diye çizim çözünürlüğünü biraz düşür.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    // Tuşlara uzun basınca tarayıcının menüsü açılmasın.
    $('touch').addEventListener('contextmenu', e => e.preventDefault());
  }

  // Rakibin sürüşü: biraz ilerideki bir hedef noktaya doğru direksiyon kırar.
  function aiInput(k, dt) {
    // Arada bir rastgele şerit değiştirir (hepsi aynı çizgide gitmesin diye).
    k.laneT -= dt;
    if (k.laneT <= 0) {
      k.laneT = 2 + Math.random() * 4;
      k.lane = (Math.random() * 2 - 1) * 5.4;
    }
    // Hızlandıkça daha ileriye bakar.
    const look = 5 + Math.floor(Math.max(0, k.speed) * 0.22);
    const j = (k.idx + look) % N;
    const targetAngle = Math.atan2(px[j] + nx[j] * k.lane - k.x, pz[j] + nz[j] * k.lane - k.z);
    const d = angDiff(targetAngle, k.h); // hedefe dönmek için gereken açı

    let gas = 1, brake = 0;
    if (Math.abs(d) > 0.7 && k.speed > 18) gas = 0;   // keskin virajda gazı keser
    if (Math.abs(d) > 1.2 && k.speed > 12) brake = 1; // çok keskinse fren yapar
    return { steer: clamp(d * 2.6, -1, 1), gas, brake, drift: false };
  }


  /* ===================================================================
     12. EŞYALAR (NİTRO, ROKET, YAĞ, KALKAN, TAMİR), ZIRH VE PARÇALANMA
     =================================================================== */

  // Ekrandaki eşya kutusunda görünen küçük çizimler.
  const ICON = {
    nitro: '<svg viewBox="0 0 48 48"><path d="M27 3 9 27h11l-3 18 20-26H25z" fill="#ffc61a" stroke="#17130f" stroke-width="2.5" stroke-linejoin="round"/></svg>',
    rocket: '<svg viewBox="0 0 48 48"><path d="M16 26 8 36h9zM32 26l8 10h-9z" fill="#27a4e0" stroke="#17130f" stroke-width="2.5" stroke-linejoin="round"/><path d="M24 3c8 7 10 17 8 27H16C14 20 16 10 24 3z" fill="#ff4a2b" stroke="#17130f" stroke-width="2.5" stroke-linejoin="round"/><circle cx="24" cy="17" r="4" fill="#fff6e0" stroke="#17130f" stroke-width="2"/><path d="M20 32h8l-4 12z" fill="#ffc61a" stroke="#17130f" stroke-width="2" stroke-linejoin="round"/></svg>',
    oil: '<svg viewBox="0 0 48 48"><ellipse cx="24" cy="35" rx="19" ry="8" fill="#2b1e3f" stroke="#17130f" stroke-width="2.5"/><path d="M24 5c6 9 9 13 9 18a9 9 0 0 1-18 0c0-5 3-9 9-18z" fill="#7a55b8" stroke="#17130f" stroke-width="2.5" stroke-linejoin="round"/></svg>',
    shield: '<svg viewBox="0 0 48 48"><path d="M24 4 41 10v13c0 10-7 17-17 21C14 40 7 33 7 23V10z" fill="#6fe3ff" stroke="#17130f" stroke-width="2.5" stroke-linejoin="round"/><path d="M24 11v26" stroke="#fff6e0" stroke-width="3"/></svg>',
    repair: '<svg viewBox="0 0 48 48"><path d="M30 5a10 10 0 0 0-9 13L6 33a5 5 0 0 0 7 7l15-15a10 10 0 0 0 13-9l-6 3-5-2-2-5z" fill="#9aa3a0" stroke="#17130f" stroke-width="2.5" stroke-linejoin="round"/><path d="M33 31h10M38 26v10" stroke="#7bd14a" stroke-width="5" stroke-linecap="round"/></svg>'
  };
  const ITEMS = ['nitro', 'rocket', 'oil', 'shield', 'repair'];

  // Kutudan hangi eşyanın çıkacağını seçer. Gerideki kartlara nitro ve roket,
  // öndekilere yağ ve kalkan daha sık çıkar. Birinciye roket çıkmaz.
  function rollItem(k) {
    const back = (k.rank - 1) / (karts.length - 1); // 0 = birinci, 1 = sonuncu
    const weights = {
      nitro: 1 + 2 * back,
      rocket: k.rank === 1 ? 0 : 0.4 + 2.2 * back,
      oil: 1.6 - 1.2 * back,
      shield: 1.2 - 0.6 * back,
      repair: k.hp < 40 ? 2.4 : k.hp < 70 ? 1 : 0.15 // zırhı azaldıkça tamir çıkma ihtimali artar
    };
    let total = 0;
    for (const i of ITEMS) total += weights[i];
    let r = Math.random() * total;
    for (const i of ITEMS) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return 'nitro';
  }

  const hazards = []; // pistteki yağ lekeleri
  const rockets = []; // havadaki roketler

  const oilGeo = new THREE.CircleGeometry(1.9, 14);
  const oilMat = new THREE.MeshBasicMaterial({
    color: 0x2b1e3f, transparent: true, opacity: 0.92,
    polygonOffset: true, polygonOffsetFactor: -7, polygonOffsetUnits: -7
  });
  const rocketBodyGeo = new THREE.CylinderGeometry(0.24, 0.24, 1.3, 8);
  rocketBodyGeo.rotateX(Math.PI / 2);
  const rocketTipGeo = new THREE.ConeGeometry(0.3, 0.7, 8);
  rocketTipGeo.rotateX(Math.PI / 2);
  const rocketBodyMat = new THREE.MeshLambertMaterial({ color: 0xfff6e0 });
  const rocketTipMat = new THREE.MeshLambertMaterial({ color: 0xff4a2b });

  // Yeni yarış başlarken pistteki bütün yağları ve roketleri kaldırır.
  function clearItems() {
    hazards.forEach(h => scene.remove(h.m));
    hazards.length = 0;
    rockets.forEach(r => scene.remove(r.m));
    rockets.length = 0;
  }

  // Bir karta hasar verir. by: hasarı veren kart (yoksa null, örneğin duvar).
  // Zırh biterse kart parçalanır. Kalkan varken hasar işlemez.
  let shake = 0; // ekran sarsıntısı (oyuncu hasar alınca)
  function damage(k, amt, by) {
    if (amt <= 0 || k.wreck > 0 || k.ghost > 0 || k.shield > 0) return;
    k.hp -= amt;
    k.hurtT = 0.25;
    if (k.isPlayer) shake = Math.max(shake, Math.min(0.9, 0.15 + amt / 40));
    if (k.hp <= 0) wreckKart(k, by);
  }

  // Kart parçalanır: büyük patlama, eşya kaybolur, birkaç saniye sonra yeniden doğar.
  function wreckKart(k, by) {
    k.hp = 0;
    k.wreck = WRECK_TIME;
    k.item = null;
    k.roul = 0;
    k.drift = 0;
    k.charge = 0;
    k.chargeT = 0;
    k.boost = 0;
    k.spin = 0;
    k.spinA = 0;
    k.hopV = 7; // patlamayla havaya sıçrar
    blast(k.x, k.z);
    const near = Math.hypot(k.x - player.x, k.z - player.z);
    if (near < 90) {
      tone(70, 0.9, 'sawtooth', 0.25, -40);
      tone(140, 0.5, 'square', 0.12, -100);
    }
    if (by && by !== k) by.kills++;
    if (state !== 'race') return;
    if (k.isPlayer) {
      shake = 1.2;
      msg('PARÇALANDIN!', 1.6);
      feed(by ? by.name + ' seni parçaladı' : 'Kartın parçalandı', true);
    } else if (by === player) {
      feed(k.name + ' parçalandı · +1', true);
    } else {
      feed(by ? by.name + ' → ' + k.name : k.name + ' parçalandı', false);
    }
  }

  // Parçalanan kart pistin ortasında, dokunulmaz olarak yeniden doğar.
  function respawn(k) {
    resetKart(k);
    k.hp = MAX_HP;
    k.ghost = GHOST_TIME;
    k.hopY = 0;
    k.hopV = 0;
    k.m.body.rotation.x = 0;
  }

  // Bir kart vurulunca (roket ya da yağ) olanlar: hasar alır ve savrulur.
  function hit(k, by, dmg) {
    if (k.wreck > 0 || k.ghost > 0) return;
    if (k.shield > 0) { // kalkan varsa darbeyi o yer ve kırılır
      k.shield = 0;
      if (k.isPlayer) tone(520, 0.2, 'triangle', 0.15, 300);
      return;
    }
    damage(k, dmg, by);
    if (k.wreck > 0) return; // bu darbeyle parçalandı
    if (k.spin > 0) return; // zaten savruluyorsa tekrar vurulmaz
    k.spin = 1.1;           // 1.1 saniye savrulur
    k.speed *= 0.35;
    k.drift = 0;
    k.chargeT = 0;
    k.charge = 0;
    k.boost = 0;
    if (k.isPlayer) tone(180, 0.5, 'sawtooth', 0.18, -120);
  }

  // Eldeki eşyayı kullanır.
  function useItem(k) {
    const it = k.item;
    k.item = null;
    if (!it) return;

    if (it === 'nitro') {
      // Nitro: 2.2 saniye turbo.
      k.boost = Math.max(k.boost, 2.2);
      if (k.isPlayer) tone(300, 0.5, 'sawtooth', 0.12, 700);

    } else if (it === 'shield') {
      // Kalkan: 9 saniye boyunca bir darbeyi engeller.
      k.shield = 9;
      if (k.isPlayer) tone(660, 0.3, 'triangle', 0.14, 300);

    } else if (it === 'repair') {
      // Tamir: zırhın bir kısmını geri verir.
      k.hp = Math.min(MAX_HP, k.hp + REPAIR);
      for (let i = 0; i < 8; i++) {
        emit(k.x + (Math.random() - 0.5) * 2, 1 + Math.random(), k.z + (Math.random() - 0.5) * 2, 0, 3, 0, 0x7bd14a, 0.6, 0.3, 0, 0);
      }
      if (k.isPlayer) {
        tone(520, 0.12, 'triangle', 0.14);
        setTimeout(() => tone(780, 0.2, 'triangle', 0.14), 110);
      }

    } else if (it === 'oil') {
      // Yağ: kartın arkasına bırakılır, üstünden geçen savrulur. 30 saniye kalır.
      const m = new THREE.Mesh(oilGeo, oilMat);
      m.rotation.x = -Math.PI / 2;
      const x = k.x - Math.sin(k.h) * 3.4;
      const z = k.z - Math.cos(k.h) * 3.4;
      m.position.set(x, 0.12, z);
      scene.add(m);
      hazards.push({ x, z, m, life: 30, owner: k, arm: 0.8 }); // arm: bırakan kişiyi ilk 0.8 sn etkilemez
      if (k.isPlayer) tone(240, 0.2, 'sine', 0.14, -100);

    } else if (it === 'rocket') {
      // Roket: bir öndeki yarışçıyı hedef alır ve pisti takip ederek ona gider.
      const g = new THREE.Group();
      const body = new THREE.Mesh(rocketBodyGeo, rocketBodyMat);
      const tip = new THREE.Mesh(rocketTipGeo, rocketTipMat);
      tip.position.z = 1;
      g.add(body);
      g.add(tip);
      scene.add(g);
      const sorted = karts.slice().sort((a, b) => b.prog - a.prog);
      const target = sorted[k.rank - 2] || null;
      rockets.push({
        x: k.x + Math.sin(k.h) * 2.5, z: k.z + Math.cos(k.h) * 2.5,
        h: k.h, idx: k.idx, lap: 0, lat: 0, m: g, life: 7, owner: k, target
      });
      if (k.isPlayer) tone(500, 0.4, 'sawtooth', 0.12, 900);
    }
  }

  // Her karede yağ lekelerini ve roketleri günceller.
  function updateItems(dt) {
    // --- Yağ lekeleri ---
    for (let i = hazards.length - 1; i >= 0; i--) {
      const h = hazards[i];
      h.life -= dt;
      h.arm -= dt;
      let gone = h.life <= 0;
      if (!gone) {
        for (const k of karts) {
          if (h.arm > 0 && k === h.owner) continue;
          if (k.wreck > 0 || k.ghost > 0) continue;
          const dx = k.x - h.x, dz = k.z - h.z;
          if (dx * dx + dz * dz < 5.3 && k.hopY < 0.15) { // zıplayan kart yağın üstünden atlar
            hit(k, h.owner === k ? null : h.owner, OIL_DMG);
            gone = true;
            break;
          }
        }
      }
      if (gone) {
        scene.remove(h.m);
        hazards.splice(i, 1);
      }
    }

    // --- Roketler ---
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      r.life -= dt;
      trackPos(r);

      // Hedef yakınsa doğrudan ona, uzaksa pistin biraz ilerisine yönelir.
      let tx, tz;
      const tg = r.target;
      if (tg) {
        const di = ((tg.idx - r.idx) + N) % N;
        if (di < 16 || di > N - 8) { tx = tg.x; tz = tg.z; }
      }
      if (tx === undefined) {
        const j = (r.idx + 6) % N;
        tx = px[j];
        tz = pz[j];
      }
      r.h += clamp(angDiff(Math.atan2(tx - r.x, tz - r.z), r.h), -5 * dt, 5 * dt);
      r.x += Math.sin(r.h) * 78 * dt; // 78 = roket hızı
      r.z += Math.cos(r.h) * 78 * dt;
      r.m.position.set(r.x, 1, r.z);
      r.m.rotation.y = r.h;
      emit(r.x - Math.sin(r.h), 1, r.z - Math.cos(r.h), 0, 1, 0, 0xffffff, 0.35, 0.4, 2, 0); // duman izi

      let gone = r.life <= 0;
      for (const k of karts) {
        if (k === r.owner || k.wreck > 0 || k.ghost > 0) continue;
        const dx = k.x - r.x, dz = k.z - r.z;
        if (dx * dx + dz * dz < 6) {
          hit(k, r.owner, ROCKET_DMG);
          gone = true;
          break;
        }
      }
      if (gone) {
        explode(r.x, r.z);
        if (Math.hypot(r.x - player.x, r.z - player.z) < 60) tone(90, 0.4, 'sawtooth', 0.16, -40);
        scene.remove(r.m);
        rockets.splice(i, 1);
      }
    }
  }


  /* ===================================================================
     13. FİZİK: BİR KARTIN HAREKETİ
     ===================================================================
     stepKart her karede her kart için bir kez çalışır.
       k   : kart
       inp : istek (direksiyon, gaz, fren, drift)
       dt  : son kareden beri geçen süre (saniye)
     Sürüş hissini değiştirmek istersen oynayacağın sayılar buradadır.
     =================================================================== */

  function stepKart(k, inp, dt) {
    if (k.bumpT > 0) k.bumpT -= dt;
    if (k.wallT > 0) k.wallT -= dt;
    if (k.hurtT > 0) k.hurtT -= dt;
    if (k.ghost > 0) k.ghost -= dt;

    // Parçalanmışsa: enkaz yanarak kayar, durur; süre dolunca yeniden doğar.
    if (k.wreck > 0) {
      k.wreck -= dt;
      k.speed -= k.speed * Math.min(1, 2.5 * dt);
      k.x += Math.sin(k.va) * k.speed * dt;
      k.z += Math.cos(k.va) * k.speed * dt;
      trackPos(k);
      if (Math.abs(k.lat) > WALL) {
        const s = Math.sign(k.lat), over = Math.abs(k.lat) - WALL;
        k.x -= nx[k.idx] * over * s;
        k.z -= nz[k.idx] * over * s;
        k.lat = WALL * s;
      }
      if (k.hopY > 0 || k.hopV > 0) {
        k.hopY += k.hopV * dt;
        k.hopV -= 26 * dt;
        if (k.hopY <= 0) { k.hopY = 0; k.hopV = 0; }
      }
      if (Math.random() < 0.6) emit(k.x + (Math.random() - 0.5), 1, k.z + (Math.random() - 0.5), 0, 4, 0, 0xff6a10, 0.4, 0.5, 1, 0);
      if (Math.random() < 0.4) emit(k.x, 1.4, k.z, (Math.random() - 0.5) * 2, 5, (Math.random() - 0.5) * 2, 0x1a1512, 1.1, 0.5, 2, 0);
      if (k.wreck <= 0) respawn(k);
      return;
    }

    // Savruluyorsa kontrol edilemez.
    if (k.spin > 0) {
      k.spin -= dt;
      k.spinA += dt * 14;
      inp = NOIN;
      if (k.spin <= 0) k.spinA = 0;
    }
    if (k.shield > 0) k.shield -= dt;

    const boosting = k.boost > 0;
    if (boosting) k.boost -= dt;

    // Çimde mi? (yolun ve kenar şeridinin dışı)
    const off = Math.abs(k.lat) > HALF_W + 1.7;

    // Hız sınırı: turboda %40 fazla, çimde yarı yarıya.
    let vmax = k.vmax * (boosting ? 1.4 : 1);
    if (off && !boosting) vmax *= 0.5;

    // --- Hızlanma ve yavaşlama ---
    if (k.spin > 0) {
      k.speed -= k.speed * 2.2 * dt;                                   // savrulurken hızla yavaşlar
    } else if (boosting) {
      if (k.speed < vmax) k.speed = Math.min(vmax, k.speed + 50 * dt); // turbo: çok hızlı ivmelenir
    } else if (inp.gas && !inp.brake) {
      // Gaz: düşük hızda güçlü, hız arttıkça zayıflayan ivme.
      k.speed += k.accel * (k.speed < 0 ? 2.2 : 1) * (1.5 - 0.68 * Math.max(0, k.speed) / k.vmax) * dt;
    } else if (inp.brake) {
      k.speed -= (k.speed > 0 ? 48 : 16) * dt;                         // fren, durunca geri vites
    } else {
      k.speed -= Math.sign(k.speed) * Math.min(Math.abs(k.speed), 9 * dt); // gaz yokken yavaşça durur
    }
    if (k.speed > vmax) k.speed -= Math.min(k.speed - vmax, (off ? 55 : 22) * dt); // sınırı aşıyorsa düşür
    if (k.speed < -11) k.speed = -11;                                  // geri vites hız sınırı

    // --- Direksiyon ---
    // Direksiyon tuşa basınca birden değil, yumuşakça döner.
    k.steerS += (inp.steer - k.steerS) * Math.min(1, dt * (inp.tilt ? TILT_SMOOTH : k.isPlayer ? 9 : 14));
    // Çok yavaşken dönüş zayıflar; geri giderken yön tersine döner.
    const speedFactor = clamp(Math.abs(k.speed) / 10, 0, 1) * (k.speed < 0 ? -1 : 1);
    let turn = k.steerS * k.turn;

    // --- Drift ---
    if (k.drift) {
      if (!inp.drift || k.speed < 13 || off || k.spin > 0) {
        // Drift bitti. Tuş bırakılarak bittiyse ve yeterince şarj olduysa turbo verir.
        if (!inp.drift && k.charge > 0) {
          k.boost = Math.max(k.boost, k.charge > 1 ? 1.6 : 0.85); // pembe: 1.6 sn, sarı: 0.85 sn
          if (k.isPlayer) tone(k.charge > 1 ? 520 : 400, 0.35, 'sawtooth', 0.12, 600);
        }
        k.drift = 0;
        k.chargeT = 0;
        k.charge = 0;
      } else {
        // Drift sürüyor. Viraj yönüne direksiyon kırmak şarjı hızlandırır.
        const into = k.steerS * k.drift;
        k.chargeT += dt * (1 + 0.6 * Math.max(0, into));
        const c = k.chargeT > 2.1 ? 2 : k.chargeT > 0.9 ? 1 : 0; // 0.9 sn'de sarı, 2.1 sn'de pembe
        if (c !== k.charge) {
          k.charge = c;
          if (k.isPlayer) tone(c === 2 ? 990 : 740, 0.09, 'square', 0.08);
        }
        turn = k.drift * (1.3 + 0.85 * into); // driftte dönüş: direksiyonla daralır ya da genişler
      }
    } else if (inp.drift && k.driftReady && Math.abs(inp.steer) > 0.4 && k.speed > 17 && !off && k.spin <= 0) {
      // Drift başlat: drift tuşu + direksiyon + yeterli hız gerekir. Kart küçük bir zıplama yapar.
      k.drift = Math.sign(inp.steer);
      k.chargeT = 0;
      k.charge = 0;
      k.hopV = 4.2;
      k.driftReady = false;
    }
    if (!inp.drift) k.driftReady = true;

    // --- Hareket ---
    k.h += turn * speedFactor * dt;
    // Gidiş yönü bakış yönünü takip eder: normalde hemen, driftte gecikmeli (kayma hissi).
    k.va += angDiff(k.h, k.va) * Math.min(1, (k.drift ? 3.2 : 10) * dt);
    k.x += Math.sin(k.va) * k.speed * dt;
    k.z += Math.cos(k.va) * k.speed * dt;
    trackPos(k);

    // Bariyere çarptıysa içeri it ve yavaşlat. Sert çarpış zırha zarar verir.
    if (Math.abs(k.lat) > WALL) {
      const s = Math.sign(k.lat);
      const into = (Math.sin(k.va) * nx[k.idx] + Math.cos(k.va) * nz[k.idx]) * k.speed * s; // duvara doğru hız
      if (into > WALL_MIN && k.wallT <= 0) {
        damage(k, (into - WALL_MIN) * WALL_DMG, null);
        k.wallT = 0.5;
        for (let i = 0; i < 6; i++) {
          emit(k.x, 0.6, k.z, (Math.random() - 0.5) * 8, 2 + Math.random() * 4, (Math.random() - 0.5) * 8, 0xffc23a, 0.3, 0.18, 0, 14);
        }
        if (k.isPlayer) tone(110, 0.2, 'square', 0.12, -50);
      }
      const over = Math.abs(k.lat) - WALL;
      k.x -= nx[k.idx] * over * s;
      k.z -= nz[k.idx] * over * s;
      k.lat = WALL * s;
      k.speed -= k.speed * Math.min(1, 3 * dt);
    }

    // Zıplama (drift başlangıcında).
    if (k.hopY > 0 || k.hopV > 0) {
      k.hopY += k.hopV * dt;
      k.hopV -= 26 * dt;
      if (k.hopY <= 0) { k.hopY = 0; k.hopV = 0; }
    }

    // --- Hasar dumanı: zırh azaldıkça motordan duman, iyice azalınca alev çıkar ---
    const hpK = k.hp / MAX_HP;
    if (hpK < 0.5 && Math.random() < (0.5 - hpK) * 1.4) {
      emit(k.x - Math.sin(k.h) * 1.2, 1.2, k.z - Math.cos(k.h) * 1.2,
        (Math.random() - 0.5) * 1.5, 2.5, (Math.random() - 0.5) * 1.5,
        hpK < 0.25 ? 0x1a1512 : 0x5a524c, 0.8, 0.45, 2.2, 0);
    }
    if (hpK < 0.25 && Math.random() < 0.35) {
      emit(k.x - Math.sin(k.h) * 1.1, 1.1, k.z - Math.cos(k.h) * 1.1, 0, 2, 0, 0xff6a10, 0.25, 0.35, 0.5, 0);
    }

    // --- Hızlandırma pedleri ---
    if (k.padT > 0) {
      k.padT -= dt;
    } else {
      for (const p of pads) {
        const di = ((k.idx - p.i) + N) % N;
        if (di <= 4 && Math.abs(k.lat - p.lane) < 3.3) {
          k.boost = Math.max(k.boost, 1.1);
          k.padT = 0.6;
          if (k.isPlayer) tone(360, 0.3, 'sawtooth', 0.1, 500);
          break;
        }
      }
    }

    // --- Eşya kutuları ---
    for (const b of boxes) {
      if (b.t > 0) continue; // kutu alınmış, henüz geri gelmedi
      const dx = k.x - b.x, dz = k.z - b.z;
      if (dx * dx + dz * dz < 5.8) {
        b.t = 3; // kutu 3 saniye sonra geri gelir
        b.m.visible = false;
        if (!k.item && k.roul <= 0) { // elinde eşya yoksa çark dönmeye başlar
          k.roul = 1.3;
          if (k.isPlayer) tone(880, 0.1, 'square', 0.1);
        }
      }
    }
    if (k.roul > 0) {
      k.roul -= dt;
      if (k.roul <= 0) { // çark durdu, eşya belli oldu
        k.item = rollItem(k);
        k.itemDelay = 1.5 + Math.random() * 5;
        if (k.isPlayer) {
          tone(660, 0.08, 'square', 0.1);
          setTimeout(() => tone(990, 0.14, 'square', 0.1), 90);
        }
      }
    }

    // --- Görsel efektler ---
    const sh = Math.sin(k.h), ch = Math.cos(k.h);
    if (k.drift) {
      // Arka tekerleklerden kıvılcım: gri (şarj yok), sarı (1. seviye), pembe (2. seviye).
      const c = k.charge === 2 ? 0xff3df0 : k.charge === 1 ? 0xffd21a : 0xe6e6e6;
      for (const lx of [1, -1]) {
        const wx = k.x + sh * -0.95 + ch * lx;
        const wz = k.z + ch * -0.95 - sh * lx;
        emit(wx, 0.25, wz,
          -sh * 4 + (Math.random() - 0.5) * 5, 2 + Math.random() * 3, -ch * 4 + (Math.random() - 0.5) * 5,
          c, 0.28, k.charge ? 0.26 : 0.2, 0, 12);
      }
    }
    if (boosting) {
      // Turbo alev izi.
      emit(k.x - sh * 2.4, 0.85, k.z - ch * 2.4, (Math.random() - 0.5) * 2, 1, (Math.random() - 0.5) * 2, 0xff8a1f, 0.25, 0.4, 1.6, 0);
    } else if (off && Math.abs(k.speed) > 8 && Math.random() < 0.5) {
      // Çimde toz.
      emit(k.x - sh * 1.2, 0.3, k.z - ch * 1.2, (Math.random() - 0.5) * 3, 2, (Math.random() - 0.5) * 3, 0x8f8250, 0.4, 0.4, 2, 0);
    }
  }

  // Kartın hesaplanan durumunu 3B modele aktarır (konum, yön, tekerlekler, alev, kalkan).
  const CHAR = new THREE.Color(0x120c08); // yanmış metal rengi
  const HURT = new THREE.Color(0xff3010); // hasar alınca parlama rengi
  function syncVisual(k, dt) {
    const m = k.m;
    m.root.position.set(k.x, 0, k.z);
    m.root.rotation.y = k.h + k.spinA;
    m.body.position.y = k.hopY;

    // Zırh azaldıkça gövde kararır; parçalanınca kömür gibi olur; vurulunca bir an kızarır.
    const charA = k.wreck > 0 ? 0.85 : (1 - k.hp / MAX_HP) * 0.55;
    const flash = k.hurtT > 0 ? 1 : 0;
    const key = Math.round(charA * 40) + flash * 100;
    if (key !== k.charA) {
      k.charA = key;
      for (const mt of m.mats) {
        mt.color.setHex(mt.userData.base).lerp(CHAR, charA);
        if (flash) mt.color.lerp(HURT, 0.5);
      }
    }
    // Enkaz yana yatmış durur. Yeniden doğunca kart bir süre yanıp söner.
    m.body.rotation.x = k.wreck > 0 ? -0.22 : 0;
    m.root.visible = !(k.ghost > 0 && Math.floor(k.ghost * 12) % 2);
    if (k.wreck > 0) {
      m.body.rotation.z = 0.55;
      for (const f of m.flames) f.visible = false;
      m.shield.visible = false;
      return;
    }

    // Virajda ve driftte gövde hafifçe yana yatar.
    const rollTarget = k.steerS * 0.05 * (k.speed / BASE_V) + k.drift * 0.09;
    k.roll += (rollTarget - k.roll) * Math.min(1, dt * 8);
    m.body.rotation.z = k.roll;

    for (const p of m.pivots) p.rotation.y = k.steerS * 0.45;       // ön tekerlekler direksiyonla döner
    for (const w of m.wheels) w.rotation.x += k.speed * dt / 0.44;  // tekerlekler hıza göre döner

    const boosting = k.boost > 0;
    for (const f of m.flames) {
      f.visible = boosting;
      if (boosting) f.scale.z = 0.7 + Math.random() * 0.7; // alev titrer
    }

    m.shield.visible = k.shield > 0;
    // Kalkan bitmeye yakın yanıp söner.
    if (k.shield > 0) m.shield.material.opacity = k.shield < 2 ? 0.12 + 0.18 * Math.abs(Math.sin(k.shield * 8)) : 0.3;
  }

  // Kartlar birbirinin içinden geçmesin: çok yakın iki kartı birbirinden iter.
  function collide() {
    for (let i = 0; i < karts.length; i++) {
      for (let j = i + 1; j < karts.length; j++) {
        const a = karts[i], b = karts[j];
        const dx = b.x - a.x, dz = b.z - a.z;
        const q = dx * dx + dz * dz;
        if (q < 4.6 && q > 1e-4) {
          if (a.ghost > 0 || b.ghost > 0) continue; // yeni doğan kart içinden geçilebilir
          const d = Math.sqrt(q);
          const push = (2.15 - d) / 2;
          const ux = dx / d, uz = dz / d;

          // Çarpışma hasarı: birbirine doğru hız ne kadar yüksekse o kadar hasar.
          // Daha hızlı dalan taraf (koçbaşıyla vuran) hasarın çoğunu karşıya verir.
          const sa = (Math.sin(a.va) * ux + Math.cos(a.va) * uz) * a.speed;    // a'nın b'ye doğru hızı
          const sb = -(Math.sin(b.va) * ux + Math.cos(b.va) * uz) * b.speed;   // b'nin a'ya doğru hızı
          const closing = sa + sb;
          if (closing > RAM_MIN && a.bumpT <= 0 && b.bumpT <= 0 && !a.wreck && !b.wreck) {
            const dmg = (closing - RAM_MIN) * RAM_DMG;
            const fa = Math.max(0, sa) / (Math.max(0, sa) + Math.max(0, sb) + 1e-6);
            damage(b, dmg * (0.3 + 0.7 * fa), a);
            damage(a, dmg * (0.3 + 0.7 * (1 - fa)), b);
            a.bumpT = b.bumpT = 0.45;
            for (let s = 0; s < 8; s++) {
              emit(a.x + ux * 1.1, 0.8, a.z + uz * 1.1, (Math.random() - 0.5) * 10, 2 + Math.random() * 5, (Math.random() - 0.5) * 10, 0xffc23a, 0.3, 0.2, 0, 14);
            }
            if (a.isPlayer || b.isPlayer) tone(95 + Math.random() * 30, 0.22, 'square', 0.16, -40);
          }
          a.x -= ux * push; a.z -= uz * push;
          b.x += ux * push; b.z += uz * push;
          const avg = (a.speed + b.speed) / 2; // hızları biraz birbirine yaklaşır
          a.speed += (avg - a.speed) * 0.25;
          b.speed += (avg - b.speed) * 0.25;
        }
      }
    }
  }


  /* ===================================================================
     14. EKRAN GÖSTERGELERİ VE MİNİ HARİTA
     =================================================================== */

  const mapC = $('map');
  const mapG = mapC.getContext('2d');
  let mapBg; // pistin önceden çizilmiş resmi
  let mapF;  // oyun konumunu harita konumuna çeviren fonksiyon

  // Mini haritanın arka planını (pistin şekli) bir kez çizer.
  (function () {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < N; i++) {
      x0 = Math.min(x0, px[i]); x1 = Math.max(x1, px[i]);
      z0 = Math.min(z0, pz[i]); z1 = Math.max(z1, pz[i]);
    }
    const pad = 26;
    const sc = (320 - pad * 2) / Math.max(x1 - x0, z1 - z0);
    const ox = (320 - (x1 - x0) * sc) / 2;
    const oz = (320 - (z1 - z0) * sc) / 2;
    mapF = (x, z) => [ox + (x - x0) * sc, oz + (z - z0) * sc];

    mapBg = document.createElement('canvas');
    mapBg.width = mapBg.height = 320;
    const g = mapBg.getContext('2d');
    g.lineJoin = 'round';
    g.beginPath();
    for (let i = 0; i <= N; i += 2) {
      const p = mapF(px[i % N], pz[i % N]);
      if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]);
    }
    g.closePath();
    g.strokeStyle = 'rgba(10,8,6,.9)'; // koyu dış çizgi
    g.lineWidth = 17;
    g.stroke();
    g.strokeStyle = '#b9aa95';            // açık renk yol
    g.lineWidth = 8;
    g.stroke();
    const s = mapF(px[0], pz[0]);         // başlangıç çizgisi işareti
    g.fillStyle = '#e8590c';
    g.fillRect(s[0] - 3, s[1] - 10, 6, 20);
  })();

  // Her karede haritaya yarışçıları nokta olarak çizer. Oyuncu büyük ve beyaz çerçeveli.
  function drawMap() {
    mapG.clearRect(0, 0, 320, 320);
    mapG.drawImage(mapBg, 0, 0);
    for (const k of karts) {
      if (k.isPlayer) continue;
      const p = mapF(k.x, k.z);
      mapG.beginPath();
      mapG.arc(p[0], p[1], 6, 0, TAU);
      mapG.fillStyle = hex(k.col);
      mapG.fill();
      mapG.lineWidth = 2;
      mapG.strokeStyle = '#17130f';
      mapG.stroke();
    }
    const p = mapF(player.x, player.z);
    mapG.beginPath();
    mapG.arc(p[0], p[1], 10, 0, TAU);
    mapG.fillStyle = hex(player.col);
    mapG.fill();
    mapG.lineWidth = 4;
    mapG.strokeStyle = '#fff';
    mapG.stroke();
  }

  // Ekranın ortasında büyük bir yazı gösterir ("3", "BAŞLA!", "SON TUR!" gibi).
  // small = true verilirse yazı küçük çıkar (uzun bilgi mesajları için).
  let msgT = 0; // yazının ekranda kalacağı süre
  function msg(text, dur, small) {
    const el = $('msg');
    el.textContent = text;
    el.classList.toggle('small', !!small);
    el.classList.remove('pop');
    void el.offsetWidth; // animasyonu baştan başlatmak için
    el.classList.add('pop');
    msgT = dur || 1;
  }

  // Saniyeyi "1:23.45" biçimine çevirir.
  function fmt(t) {
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
  }

  // Ekrandaki sıra, tur, süre, hız ve eşya göstergelerini günceller.
  // Değişmeyen şeyleri boşuna yeniden yazmamak için son değerler saklanır.
  let hudRank = 0, hudLap = 0, hudItem = '', rouI = 0, rouT = 0, hudHp = -1;

  // Sağdaki olay akışı ("Bora parçalandı" gibi). Yazılar 3 saniye sonra kaybolur.
  function feed(text, mine) {
    const el = document.createElement('div');
    el.textContent = text;
    if (mine) el.className = 'mine';
    const box = $('feed');
    box.prepend(el);
    while (box.children.length > 4) box.lastChild.remove();
    setTimeout(() => el.remove(), 3200);
  }
  function updateHud(dt) {
    if (player.rank !== hudRank) {
      hudRank = player.rank;
      $('posN').textContent = hudRank;
    }
    const lp = clamp(player.lap, 1, LAPS);
    if (lp !== hudLap) {
      hudLap = lp;
      $('lap').textContent = 'TUR ' + lp + '/' + LAPS;
    }
    $('time').textContent = fmt(player.finished ? player.finishTime : raceTime);
    $('spd').textContent = Math.round(Math.abs(player.speed) * 3.6);

    // Zırh çubuğu: doluluk ve renk (sağlam: sarı, azalınca turuncu, kritik: kırmızı ve yanıp söner).
    const hpP = Math.max(0, Math.round(player.hp));
    if (hpP !== hudHp) {
      hudHp = hpP;
      $('hpFill').style.width = hpP + '%';
      $('hp').className = hpP < 25 ? 'crit' : hpP < 55 ? 'low' : '';
    }
    $('hurt').style.opacity = player.hurtT > 0 ? Math.min(1, player.hurtT * 4) : player.wreck > 0 ? 0.6 : 0;

    let it = player.item || '';
    if (player.roul > 0) { // eşya çarkı dönerken eşyalar hızla değişir
      rouT -= dt;
      if (rouT <= 0) { rouT = 0.08; rouI = (rouI + 1) % ITEMS.length; }
      it = ITEMS[rouI];
    }
    if (it !== hudItem) {
      hudItem = it;
      $('itemIcon').innerHTML = it ? ICON[it] : '';
    }
    // Eğim göstergesi: sarı nokta telefonu eğdiğin yöne kayar.
    if (tilt.want && tilt.on) $('tiltDot').style.left = (50 - (tiltActive() ? tilt.value : 0) * 50) + '%';
    drawMap();
  }


  /* ===================================================================
     15. OYUN DURUMU: MENÜ, GERİ SAYIM, YARIŞ, BİTİŞ
     ===================================================================
     state değişkeni oyunun hangi aşamada olduğunu tutar:
       'menu'  : menü açık, arkada rakipler kendi kendine yarışıyor
       'count' : 3-2-1 geri sayım
       'race'  : yarış sürüyor
       'done'  : oyuncu bitirdi, sonuç ekranı
     =================================================================== */

  let state = 'menu';
  let paused = false;
  let countT = 0, lastCount = 0; // geri sayım sayacı
  let raceTime = 0;              // yarış süresi
  let finCount = 0;              // kaç yarışçı bitirdi
  let time = 0;                  // oyun açıldığından beri geçen süre (animasyonlar için)
  let orbitA = 0;                // menüde kameranın adanın etrafındaki açısı
  let camA = 0, camFov = 68;     // yarışta kameranın açısı ve görüş genişliği
  let camD = 8.6, camH = 4.1;    // kameranın karta uzaklığı ve yüksekliği
  let wrongT = 0;                // ne kadar süredir ters yönde gidiliyor
  let doneT = 0;                 // bitişten beri geçen süre
  let resShown = false, resTick = 0;

  // Menüde seçilen renge göre oyuncunun kartını yeniden yapar.
  function setPlayerColor() {
    if (playerColApplied === pcol) return;
    scene.remove(player.m.root);
    player.col = PCOLS[pcol].c;
    player.m = makeKart(player.col, 0x2e2a26);
    scene.add(player.m.root);
    playerColApplied = pcol;
  }

  // Yeni yarış başlatır: her şeyi sıfırlar ve geri sayımı açar.
  function startRace() {
    initAudio();
    if (AC && AC.state === 'suspended') AC.resume();
    enableTilt();   // telefonun hareket sensörünü aç (izin verilirse)
    goLandscape();  // telefonda tam ekran + yatay kilit dene
    setPlayerColor();
    clearItems();
    placeGrid();
    for (const b of boxes) { b.t = 0; b.m.visible = true; }

    state = 'count';
    paused = false;
    countT = 3.7;
    lastCount = 4;
    raceTime = 0;
    finCount = 0;
    gasAt = 99;
    wantItem = false;
    doneT = 0;
    resShown = false;
    hudRank = hudLap = 0;
    hudHp = -1;
    shake = 0;
    $('feed').innerHTML = '';
    hudItem = 'x';
    camA = player.h;
    camFov = 68;
    camD = 8.6;
    camH = 4.1;
    touch.auto = isTouch;

    $('menu').hidden = true;
    $('results').hidden = true;
    $('hud').hidden = false;
    $('touch').hidden = !isTouch;
    $('wrong').hidden = true;
    $('msg').textContent = '';
    applyTouchLayout();
    checkRotate();
    for (const k of karts) syncVisual(k, 0);
  }

  function toMenu() {
    state = 'menu';
    paused = false;
    checkRotate();
    $('menu').hidden = false;
    $('results').hidden = true;
    $('hud').hidden = true;
    $('touch').hidden = true;
    if (engGain) engGain.gain.value = 0;
  }

  function togglePause() {
    paused = !paused;
    $('msg').textContent = paused ? 'DURAKLATILDI' : '';
    if (engGain && paused) engGain.gain.value = 0;
  }

  // Sonuç ekranını doldurur: sıralama, süreler ve en iyi süre.
  function showResults() {
    const sorted = karts.slice().sort((a, b) => a.rank - b.rank);
    $('resTitle').textContent =
      player.rank === 1 ? 'Birinci oldun!' :
      player.rank <= 3 ? player.rank + '. bitirdin, podyumdasın' :
      player.rank + '. bitirdin';

    $('resList').innerHTML = sorted.map(k =>
      '<li class="' + (k.isPlayer ? 'me' : '') + '">' +
      '<span>' + k.rank + '.</span>' +
      '<span><i style="background:' + hex(k.col) + '"></i>' + k.name + '</span>' +
      '<span>' + (k.finished ? fmt(k.finishTime) : 'yarışıyor') + '</span></li>'
    ).join('');
    $('kills').textContent = player.kills
      ? 'Parçaladığın rakip: ' + player.kills
      : 'Bu yarışta kimseyi parçalamadın.';

    if (!resShown) {
      resShown = true;
      // En iyi süre tarayıcının hafızasında saklanır (her zorluk için ayrı).
      let best = null;
      try { best = parseFloat(localStorage.getItem('fk_best_' + diff)); } catch (e) { /* hafıza kapalıysa geç */ }
      const t = player.finishTime;
      let text;
      if (!best || t < best) {
        try { localStorage.setItem('fk_best_' + diff, String(t)); } catch (e) { /* geç */ }
        text = best ? 'Yeni rekor! Eski en iyi süren ' + fmt(best) + ' idi.' : 'İlk süren kaydedildi: ' + fmt(t);
      } else {
        text = 'Bu zorlukta en iyi süren: ' + fmt(best);
      }
      $('best').textContent = text;
      $('results').hidden = false;
      $('touch').hidden = true;
    }
  }


  /* ===================================================================
     16. ANA DÖNGÜ
     ===================================================================
     update fonksiyonu saniyede yaklaşık 60 kez çalışır ve oyundaki her şeyi
     bir adım ilerletir. dt, son kareden beri geçen süredir (saniye).
     =================================================================== */

  function update(dt) {
    time += dt;

    // --- Dünyadaki süs animasyonları ---
    gemMat.emissive.setHSL(0.07, 1, 0.22 + 0.16 * Math.sin(time * 5)); // sandıkların kenarları kor gibi yanıp söner
    for (const b of boxes) {
      if (b.t > 0) {
        b.t -= dt;
        if (b.t <= 0) b.m.visible = true;                  // alınan kutu geri gelir
      }
      b.m.rotation.y = time * 2;
      b.m.position.y = 1.5 + Math.sin(time * 3 + b.x) * 0.2;
    }
    padTex.offset.y = -(time * 1.6) % 1;                   // pedlerdeki oklar akar
    for (const c of clouds) {
      c.position.x += dt * 3;
      if (c.position.x > 1200) c.position.x = -1200;
    }
    // Baca dumanları: yükselir, büyür, sürüklenir ve baştan başlar.
    for (const st of stacks) {
      for (const pf of st.puffs) {
        pf.t = (pf.t + dt * 0.12) % 1;
        pf.m.position.set(pf.t * 30, st.h + 2 + pf.t * 40, pf.t * 8);
        pf.m.scale.setScalar(5 + pf.t * 16);
      }
    }

    if (msgT > 0) {
      msgT -= dt;
      if (msgT <= 0) $('msg').textContent = '';
    }

    if (state === 'count') {
      // --- Geri sayım ---
      countT -= dt;
      const n = Math.ceil(countT);
      if (n !== lastCount) {
        lastCount = n;
        if (n >= 1 && n <= 3) {
          msg(String(n), 1.2);
          tone(440, 0.18, 'square', 0.14);
        }
      }
      if (countT <= 0) {
        state = 'race';
        msg('BAŞLA!', 1);
        tone(880, 0.5, 'square', 0.14);
        // Hızlı kalkış: "1" görünürken gaza basıldıysa başlangıçta turbo verilir.
        const held = keys.ArrowUp || keys.KeyW;
        if (held && gasAt > 0.05 && gasAt < 0.95) {
          player.boost = 1.3;
          setTimeout(() => { if (state === 'race') msg('Mükemmel kalkış!', 1); }, 500);
        }
        // Rakiplerin dörtte biri de iyi kalkış yapar.
        for (const k of karts) if (!k.isPlayer && Math.random() < 0.25) k.boost = 0.8;
        // Eğerek sürüş seçildi ama sensörden veri gelmediyse oyuncuya haber ver.
        if (tilt.want && !tilt.on) {
          setTimeout(() => { if (state === 'race' && !tilt.on) msg('Hareket sensörü kapalı, ok tuşlarıyla sür', 2.5, true); }, 1300);
        }
      }
      for (const k of karts) syncVisual(k, dt);

    } else {
      // --- Menü (arka plan yarışı), yarış ve bitiş ---
      if (state === 'race') raceTime += dt;
      const playerProgress = player.lap * N + player.idx;

      for (const k of karts) {
        let inp;
        if (k.isPlayer && state === 'race') {
          // Oyuncu: tuşları oku.
          inp = window.__kart.auto ? aiInput(k, dt) : playerInput();
          k.vmax = BASE_V;
          if (wantItem) {
            wantItem = false;
            if (k.item) useItem(k);
          }
        } else {
          // Rakip (ya da menüde ve bitişte kendi kendine giden oyuncu kartı).
          inp = aiInput(k, dt);

          // Denge ayarı: oyuncunun çok önündeki rakip biraz yavaşlar, çok gerisindeki biraz hızlanır.
          let rubber = 1;
          if (state !== 'menu' && !k.isPlayer) {
            const d = k.lap * N + k.idx - playerProgress;
            rubber = d > 130 ? 0.93 : d < -130 ? 1.07 : 1;
          }
          k.vmax = BASE_V * (k.isPlayer ? 0.9 : k.skill) * rubber;

          // Elinde eşya varsa biraz bekleyip kullanır. Birinciyse roketi atacak kimse yoktur, bekler.
          if (k.item) {
            k.itemDelay -= dt;
            if (k.itemDelay <= 0) {
              if (k.item === 'rocket' && k.rank === 1) k.itemDelay = 2;
              else useItem(k);
            }
          }
          // 2.5 saniyeden uzun takılı kalırsa yolun ortasına geri konur.
          if (Math.abs(k.speed) < 4 && k.spin <= 0 && k.wreck <= 0) {
            k.stuck += dt;
            if (k.stuck > 2.5) resetKart(k);
          } else {
            k.stuck = 0;
          }
        }

        const lapBefore = k.lap;
        stepKart(k, inp, dt);

        // Yarışı bitirdi mi?
        if (state !== 'menu' && !k.finished && k.lap > LAPS) {
          k.finished = true;
          k.finishTime = raceTime;
          k.finishOrder = ++finCount;
          if (k.isPlayer) {
            state = 'done';
            doneT = 0;
            msg('BİTTİ!', 2);
            tone(660, 0.15, 'square', 0.14);
            setTimeout(() => tone(880, 0.15, 'square', 0.14), 160);
            setTimeout(() => tone(1320, 0.4, 'square', 0.14), 320);
          }
        } else if (k.isPlayer && state === 'race' && k.lap > lapBefore && k.lap > 1) {
          // Oyuncu yeni tura girdi.
          if (k.lap === LAPS) {
            msg('SON TUR!', 1.6);
            tone(990, 0.12, 'square', 0.12);
            setTimeout(() => tone(990, 0.3, 'square', 0.12), 160);
          } else {
            msg(k.lap + '. TUR', 1.1);
            tone(740, 0.15, 'square', 0.1);
          }
        }
      }

      collide();
      updateItems(dt);

      // Sıralama: bitirenler bitiş sırasına göre, diğerleri kat ettikleri yola göre.
      for (const k of karts) {
        k.prog = k.finished ? 1e7 - k.finishOrder * 1000 : k.lap * N + k.idx;
        syncVisual(k, dt);
      }
      karts.slice().sort((a, b) => b.prog - a.prog).forEach((k, i) => { k.rank = i + 1; });

      // 1 saniyeden uzun ters yönde gidilirse "TERS YÖN" uyarısı.
      if (state === 'race') {
        const wrong = Math.cos(angDiff(player.h, hd[player.idx])) < -0.3 && player.speed > 5;
        wrongT = wrong ? wrongT + dt : 0;
        $('wrong').hidden = wrongT < 1;
      }
      // Bitişten 2.2 saniye sonra sonuç ekranı açılır ve yarım saniyede bir yenilenir.
      if (state === 'done') {
        $('wrong').hidden = true;
        doneT += dt;
        resTick -= dt;
        if (doneT > 2.2 && resTick <= 0) {
          resTick = 0.5;
          showResults();
        }
      }
    }

    updateParts(dt);

    // --- Kamera ---
    if (state === 'menu') {
      // Menüde: adanın etrafında yüksekten yavaşça döner.
      orbitA += dt * 0.07;
      camera.fov = 55;
      camera.position.set(8 + Math.sin(orbitA) * 330, 125, Math.cos(orbitA) * 330);
      camera.lookAt(8, 0, 0);
    } else {
      // Yarışta: oyuncunun arkasından takip eder. Bitişte kartın etrafında döner.
      const k = player;
      if (state === 'done') camA += dt * 0.5;
      else camA += angDiff(k.va + angDiff(k.h, k.va) * 0.4, camA) * Math.min(1, dt * 6);
      // Hasar alınca ekran sarsılır.
      shake = Math.max(0, shake - dt * 2.2);
      const sx = (Math.random() - 0.5) * shake, sy = (Math.random() - 0.5) * shake;
      // Hızlandıkça ve turboda görüş açısı genişler (hız hissi verir).
      camFov += ((66 + (k.boost > 0 ? 13 : 0) + Math.max(0, k.speed) * 0.14) - camFov) * Math.min(1, dt * 4);
      camera.fov = camFov;
      // Kameranın karta uzaklığı: bitişte ve kart parçalanınca geri ve yukarı çekilir (enkaz görünsün).
      const wantD = state === 'done' ? 11 : k.wreck > 0 ? 13 : 8.6;
      const wantH = k.wreck > 0 ? 7.5 : 4.1;
      camD += (wantD - camD) * Math.min(1, dt * 3);
      camH += (wantH - camH) * Math.min(1, dt * 3);
      camera.position.set(k.x - Math.sin(camA) * camD + sx, camH + sy, k.z - Math.cos(camA) * camD);
      camera.lookAt(k.x + Math.sin(camA) * 5, 1.7, k.z + Math.cos(camA) * 5);
    }
    camera.updateProjectionMatrix();

    if (state !== 'menu') updateHud(dt);

    // --- Motor sesi: hıza göre incelir ---
    if (AC && engOsc) {
      const on = state === 'race' || state === 'count' || state === 'done';
      const rev = state === 'count'
        ? ((keys.ArrowUp || keys.KeyW) ? 140 : 75)
        : 60 + Math.abs(player.speed) * 3.3 + (player.boost > 0 ? 35 : 0);
      engOsc.frequency.setTargetAtTime(rev, AC.currentTime, 0.05);
      engGain.gain.setTargetAtTime(on ? 0.07 : 0, AC.currentTime, 0.1);
    }
  }

  // --- Menü tuşlarını bağla ---
  // Renk seçme düğmeleri PCOLS listesinden otomatik üretilir.
  PCOLS.forEach((p, i) => {
    const b = document.createElement('button');
    b.id = 'c' + i;
    b.className = 'sw';
    b.title = p.n;
    b.setAttribute('aria-label', p.n);
    b.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
    b.style.background = hex(p.c);
    b.addEventListener('click', () => {
      pcol = i;
      [...$('colors').children].forEach((c, j) => c.setAttribute('aria-pressed', j === i ? 'true' : 'false'));
      setPlayerColor();
    });
    $('colors').appendChild(b);
  });
  // Zorluk düğmeleri.
  [...$('diffs').children].forEach(b => b.addEventListener('click', () => {
    diff = +b.dataset.d;
    [...$('diffs').children].forEach(c => c.setAttribute('aria-pressed', c === b ? 'true' : 'false'));
  }));
  // Direksiyon seçimi (sadece telefon ve tablette görünür): eğerek ya da tuşlarla.
  $('steerRow').hidden = !isTouch;
  function setSteerMode(wantTilt) {
    tilt.want = wantTilt;
    [...$('steers').children].forEach(c => c.setAttribute('aria-pressed', (c.dataset.s === 'tilt') === wantTilt ? 'true' : 'false'));
    try { localStorage.setItem('fk_steer', wantTilt ? 'tilt' : 'btn'); } catch (e) { /* geç */ }
  }
  [...$('steers').children].forEach(b => b.addEventListener('click', () => setSteerMode(b.dataset.s === 'tilt')));
  setSteerMode(tilt.want);

  $('start').addEventListener('click', startRace);
  $('again').addEventListener('click', startRace);
  $('toMenu').addEventListener('click', toMenu);

  // Pencere boyutu değişince (ya da telefon çevrilince) çizim alanını ona uydur.
  function resize() {
    const w = window.innerWidth || 1, h = window.innerHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    checkRotate();
  }
  addEventListener('resize', resize);
  resize();

  // İlk kurulum: kartları diz ve döngüyü başlat.
  placeGrid();
  for (const k of karts) syncVisual(k, 0);

  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);                 // bir sonraki kare için kendini yeniden çağır
    const dt = Math.min(0.05, (now - last) / 1000); // oyun takılırsa adım çok büyümesin
    last = now;
    if (!paused && !rotateBlock) update(dt);      // duraklatılmışsa ya da telefon dikse oyun bekler
    renderer.render(scene, camera);               // sahneyi ekrana çiz
  }
  requestAnimationFrame(frame);

  // Test yardımcıları: oyunu denemek için dışarıdan erişim sağlar, oyunu etkilemez.
  // (auto = true yapılırsa oyuncunun kartını da bilgisayar sürer.)
  window.__kart = {
    karts, player, keys, tilt, playerInput, auto: false, damage,
    get state() { return state; },
    startRace,
    step(n, dt) {
      for (let i = 0; i < n; i++) update(dt || 1 / 60);
      renderer.render(scene, camera);
    }
  };
})();
