;; The SIMD arm of the YIQ-distance measurement, in WebAssembly text.
;;
;; Source for `yiq-simd.wasm`, which is checked in beside it because assembling
;; it needs a toolchain this repository does not otherwise carry. Regenerate
;; with:
;;
;;   npx -y wabt wat2wasm --enable-simd scripts/yiq-simd.wat -o scripts/yiq-simd.wasm
;;
;; Read `scripts/simd.mjs` for what it is being compared against, and
;; docs/context/journal/0042 for what the comparison said. This is a measurement
;; arm, not a shipped kernel: nothing in the package imports it.
;;
;; YIQ distance, 4 pixels per iteration, SIMD128.
;; Two variants: "yiq" (unconditional) and "yiqSkip" (skips 4-pixel groups
;; whose 16 bytes are identical, mirroring the JS early-out).
(module
  (memory (export "mem") 256)

  ;; -- 32-bit lane shuffle masks written as byte indices -------------------
  ;; t0 = [x.0, y.0, x.1, y.1]   t1 = [x.2, y.2, x.3, y.3]
  ;; R  = [t0.0, t0.1, t2.0, t2.1]   G = [t0.2, t0.3, t2.2, t2.3]
  ;; B  = [t1.0, t1.1, t3.0, t3.1]

  (func $core (param $pa i32) (param $pb i32) (param $pout i32) (param $npix i32) (param $skip i32)
    (local $i i32)
    (local $va v128) (local $vb v128)
    (local $dl v128) (local $dh v128)
    (local $p0 v128) (local $p1 v128) (local $p2 v128) (local $p3 v128)
    (local $t0 v128) (local $t1 v128) (local $t2 v128) (local $t3 v128)
    (local $R v128) (local $G v128) (local $B v128)
    (local $y v128) (local $iq v128) (local $q v128)
    (local $zero v128)
    (local $yr v128) (local $yg v128) (local $yb v128)
    (local $ir v128) (local $ig v128) (local $ib v128)
    (local $qr v128) (local $qg v128) (local $qb v128)
    (local $ky v128) (local $ki v128) (local $kq v128) (local $inv v128)

    (local.set $yr (f32x4.splat (f32.const 0.29889531)))
    (local.set $yg (f32x4.splat (f32.const 0.58662247)))
    (local.set $yb (f32x4.splat (f32.const 0.11448223)))
    (local.set $ir (f32x4.splat (f32.const 0.59597799)))
    (local.set $ig (f32x4.splat (f32.const -0.2741761)))
    (local.set $ib (f32x4.splat (f32.const -0.32180189)))
    (local.set $qr (f32x4.splat (f32.const 0.21147017)))
    (local.set $qg (f32x4.splat (f32.const -0.52261711)))
    (local.set $qb (f32x4.splat (f32.const 0.31114694)))
    (local.set $ky (f32x4.splat (f32.const 0.5053)))
    (local.set $ki (f32x4.splat (f32.const 0.299)))
    (local.set $kq (f32x4.splat (f32.const 0.1957)))
    (local.set $inv (f32x4.splat (f32.const 0.0000283970)))  ;; 1 / 35215
    (local.set $zero (v128.const i32x4 0 0 0 0))

    (block $done
      (loop $l
        (br_if $done (i32.ge_u (local.get $i) (local.get $npix)))

        (local.set $va (v128.load (i32.add (local.get $pa) (i32.shl (local.get $i) (i32.const 2)))))
        (local.set $vb (v128.load (i32.add (local.get $pb) (i32.shl (local.get $i) (i32.const 2)))))

        (if (i32.and (local.get $skip)
                     (i32.eqz (v128.any_true (v128.xor (local.get $va) (local.get $vb)))))
          (then
            (v128.store (i32.add (local.get $pout) (i32.shl (local.get $i) (i32.const 2)))
                        (local.get $zero)))
          (else
            ;; u8 -> i16 differences, low half (pixels 0,1) and high half (2,3)
            (local.set $dl (i16x8.sub (i16x8.extend_low_i8x16_u (local.get $va))
                                      (i16x8.extend_low_i8x16_u (local.get $vb))))
            (local.set $dh (i16x8.sub (i16x8.extend_high_i8x16_u (local.get $va))
                                      (i16x8.extend_high_i8x16_u (local.get $vb))))

            ;; i16 -> i32 -> f32, one pixel's RGBA per vector
            (local.set $p0 (f32x4.convert_i32x4_s (i32x4.extend_low_i16x8_s (local.get $dl))))
            (local.set $p1 (f32x4.convert_i32x4_s (i32x4.extend_high_i16x8_s (local.get $dl))))
            (local.set $p2 (f32x4.convert_i32x4_s (i32x4.extend_low_i16x8_s (local.get $dh))))
            (local.set $p3 (f32x4.convert_i32x4_s (i32x4.extend_high_i16x8_s (local.get $dh))))

            ;; 4x4 transpose: pixel-major -> channel-major
            (local.set $t0 (i8x16.shuffle 0 1 2 3 16 17 18 19 4 5 6 7 20 21 22 23
                                          (local.get $p0) (local.get $p1)))
            (local.set $t1 (i8x16.shuffle 8 9 10 11 24 25 26 27 12 13 14 15 28 29 30 31
                                          (local.get $p0) (local.get $p1)))
            (local.set $t2 (i8x16.shuffle 0 1 2 3 16 17 18 19 4 5 6 7 20 21 22 23
                                          (local.get $p2) (local.get $p3)))
            (local.set $t3 (i8x16.shuffle 8 9 10 11 24 25 26 27 12 13 14 15 28 29 30 31
                                          (local.get $p2) (local.get $p3)))

            (local.set $R (i8x16.shuffle 0 1 2 3 4 5 6 7 16 17 18 19 20 21 22 23
                                         (local.get $t0) (local.get $t2)))
            (local.set $G (i8x16.shuffle 8 9 10 11 12 13 14 15 24 25 26 27 28 29 30 31
                                         (local.get $t0) (local.get $t2)))
            (local.set $B (i8x16.shuffle 0 1 2 3 4 5 6 7 16 17 18 19 20 21 22 23
                                         (local.get $t1) (local.get $t3)))

            (local.set $y (f32x4.add (f32x4.add (f32x4.mul (local.get $R) (local.get $yr))
                                                (f32x4.mul (local.get $G) (local.get $yg)))
                                     (f32x4.mul (local.get $B) (local.get $yb))))
            (local.set $iq (f32x4.add (f32x4.add (f32x4.mul (local.get $R) (local.get $ir))
                                                 (f32x4.mul (local.get $G) (local.get $ig)))
                                      (f32x4.mul (local.get $B) (local.get $ib))))
            (local.set $q (f32x4.add (f32x4.add (f32x4.mul (local.get $R) (local.get $qr))
                                                (f32x4.mul (local.get $G) (local.get $qg)))
                                     (f32x4.mul (local.get $B) (local.get $qb))))

            (v128.store (i32.add (local.get $pout) (i32.shl (local.get $i) (i32.const 2)))
              (f32x4.mul
                (f32x4.add (f32x4.add (f32x4.mul (local.get $ky) (f32x4.mul (local.get $y) (local.get $y)))
                                      (f32x4.mul (local.get $ki) (f32x4.mul (local.get $iq) (local.get $iq))))
                           (f32x4.mul (local.get $kq) (f32x4.mul (local.get $q) (local.get $q))))
                (local.get $inv)))))

        (local.set $i (i32.add (local.get $i) (i32.const 4)))
        (br $l)))
  )

  (func (export "yiq") (param $pa i32) (param $pb i32) (param $pout i32) (param $npix i32)
    (call $core (local.get $pa) (local.get $pb) (local.get $pout) (local.get $npix) (i32.const 0)))

  (func (export "yiqSkip") (param $pa i32) (param $pb i32) (param $pout i32) (param $npix i32)
    (call $core (local.get $pa) (local.get $pb) (local.get $pout) (local.get $npix) (i32.const 1)))
)
