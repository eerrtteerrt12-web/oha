;; Dense Gaussian elimination with partial pivoting.
;; Input: row-normalized augmented n*(n+1) f64 matrix at byte 0.
;; Output: n f64 values at byte 65536. Status: 0 success, 1 rank deficient.
;; Caller validates finite entries and 1 <= n <= 64.
(module
  (memory (export "memory") 2)
  (func $addr (param $r i32) (param $c i32) (param $width i32) (result i32)
    (i32.mul (i32.add (i32.mul (local.get $r) (local.get $width)) (local.get $c)) (i32.const 8)))
  (func (export "solve") (param $n i32) (result i32)
    (local $w i32) (local $k i32) (local $i i32) (local $j i32) (local $pivot i32)
    (local $max f64) (local $v f64) (local $temp f64) (local $factor f64) (local $sum f64)
    (if (i32.or (i32.lt_s (local.get $n) (i32.const 1)) (i32.gt_s (local.get $n) (i32.const 64)))
      (then (return (i32.const 1))))
    (local.set $w (i32.add (local.get $n) (i32.const 1)))
    (local.set $k (i32.const 0))
    (block $done
      (loop $columns
        (br_if $done (i32.ge_s (local.get $k) (local.get $n)))
        (local.set $pivot (local.get $k))
        (local.set $max (f64.abs (f64.load (call $addr (local.get $k) (local.get $k) (local.get $w)))))
        (local.set $i (i32.add (local.get $k) (i32.const 1)))
        (block $found
          (loop $search
            (br_if $found (i32.ge_s (local.get $i) (local.get $n)))
            (local.set $v (f64.abs (f64.load (call $addr (local.get $i) (local.get $k) (local.get $w)))))
            (if (f64.gt (local.get $v) (local.get $max))
              (then (local.set $max (local.get $v)) (local.set $pivot (local.get $i))))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $search)))
        (if (f64.lt (local.get $max) (f64.const 1e-12))
          (then (return (i32.const 1))))
        (if (i32.ne (local.get $pivot) (local.get $k))
          (then
            (local.set $j (local.get $k))
            (block $swapped
              (loop $swap
                (br_if $swapped (i32.ge_s (local.get $j) (local.get $w)))
                (local.set $temp (f64.load (call $addr (local.get $k) (local.get $j) (local.get $w))))
                (f64.store (call $addr (local.get $k) (local.get $j) (local.get $w))
                  (f64.load (call $addr (local.get $pivot) (local.get $j) (local.get $w))))
                (f64.store (call $addr (local.get $pivot) (local.get $j) (local.get $w)) (local.get $temp))
                (local.set $j (i32.add (local.get $j) (i32.const 1)))
                (br $swap)))))
        (local.set $i (i32.add (local.get $k) (i32.const 1)))
        (block $eliminated
          (loop $rows
            (br_if $eliminated (i32.ge_s (local.get $i) (local.get $n)))
            (local.set $factor
              (f64.div (f64.load (call $addr (local.get $i) (local.get $k) (local.get $w)))
                       (f64.load (call $addr (local.get $k) (local.get $k) (local.get $w)))))
            (f64.store (call $addr (local.get $i) (local.get $k) (local.get $w)) (f64.const 0))
            (local.set $j (i32.add (local.get $k) (i32.const 1)))
            (block $updated
              (loop $entries
                (br_if $updated (i32.ge_s (local.get $j) (local.get $w)))
                (f64.store (call $addr (local.get $i) (local.get $j) (local.get $w))
                  (f64.sub
                    (f64.load (call $addr (local.get $i) (local.get $j) (local.get $w)))
                    (f64.mul (local.get $factor) (f64.load (call $addr (local.get $k) (local.get $j) (local.get $w))))))
                (local.set $j (i32.add (local.get $j) (i32.const 1)))
                (br $entries)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $rows)))
        (local.set $k (i32.add (local.get $k) (i32.const 1)))
        (br $columns)))
    (local.set $i (i32.sub (local.get $n) (i32.const 1)))
    (block $solved
      (loop $back
        (br_if $solved (i32.lt_s (local.get $i) (i32.const 0)))
        (local.set $sum (f64.load (call $addr (local.get $i) (local.get $n) (local.get $w))))
        (local.set $j (i32.add (local.get $i) (i32.const 1)))
        (block $summed
          (loop $terms
            (br_if $summed (i32.ge_s (local.get $j) (local.get $n)))
            (local.set $sum
              (f64.sub (local.get $sum)
                (f64.mul (f64.load (call $addr (local.get $i) (local.get $j) (local.get $w)))
                         (f64.load (i32.add (i32.const 65536) (i32.mul (local.get $j) (i32.const 8)))))))
            (local.set $j (i32.add (local.get $j) (i32.const 1)))
            (br $terms)))
        (f64.store (i32.add (i32.const 65536) (i32.mul (local.get $i) (i32.const 8)))
          (f64.div (local.get $sum) (f64.load (call $addr (local.get $i) (local.get $i) (local.get $w)))))
        (local.set $i (i32.sub (local.get $i) (i32.const 1)))
        (br $back)))
    (i32.const 0))
)
