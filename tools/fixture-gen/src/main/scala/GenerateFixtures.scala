import org.apache.spark.sql.{SparkSession, SaveMode}
import org.apache.spark.sql.functions._
import org.apache.spark.sql.types._
import java.nio.file.{Files, Paths, StandardCopyOption}
import scala.util.Random

/**
 * Writes REAL Spark-authored parquet fixtures for parquet-lens tests.
 * Real Spark output means: part-<n>-<uuid>-c000.snappy.parquet naming, _SUCCESS markers,
 * .crc sidecars, Hive-style partition directories, and the
 * org.apache.spark.sql.parquet.row.metadata key in the parquet footer.
 */
object GenerateFixtures {

  def main(args: Array[String]): Unit = {
    val outRoot = if (args.nonEmpty) args(0) else "fixtures"
    val withBig = args.contains("--big")

    val spark = SparkSession.builder()
      .appName("parquet-lens-fixtures")
      .master("local[*]")
      .config("spark.sql.shuffle.partitions", "8")
      .config("spark.ui.enabled", "false")
      .getOrCreate()

    import spark.implicits._
    spark.sparkContext.setLogLevel("WARN")

    def out(name: String) = s"$outRoot/$name"

    // 1. simple: one part file, mixed primitive types
    println("[fixtures] simple")
    val simple = (1 to 1000).map { i =>
      (i, s"user_$i", i * 1.5, i % 2 == 0, java.sql.Date.valueOf("2024-01-01"))
    }.toDF("id", "name", "amount", "active", "created_on")
    simple.coalesce(1).write.mode(SaveMode.Overwrite).parquet(out("simple"))

    // 2. multipart: 8 part files, the everyday Spark shape
    println("[fixtures] multipart")
    val multi = (1 to 40000).map { i =>
      (i, s"acct_${i % 997}", (i % 13) * 101.25, s"region_${i % 5}")
    }.toDF("id", "account", "amount", "region")
    multi.repartition(8).write.mode(SaveMode.Overwrite).parquet(out("multipart"))

    // 3. partitioned: two-level Hive partitioning.
    //    year= and month= exist ONLY as directory names, never inside the parquet files.
    println("[fixtures] partitioned")
    val partitioned = (1 to 24000).map { i =>
      val year = 2023 + (i % 2)
      val month = 1 + (i % 6)
      (i, s"evt_$i", (i % 77) * 3.5, year, month)
    }.toDF("id", "event", "value", "year", "month")
    partitioned.write.mode(SaveMode.Overwrite)
      .partitionBy("year", "month").parquet(out("partitioned"))

    // 4. nested: struct, array, map, array-of-struct
    println("[fixtures] nested")
    val nestedSchema = StructType(Seq(
      StructField("id", IntegerType, nullable = false),
      StructField("profile", StructType(Seq(
        StructField("first", StringType, nullable = true),
        StructField("last", StringType, nullable = true),
        StructField("score", DoubleType, nullable = true)
      )), nullable = true),
      StructField("tags", ArrayType(StringType), nullable = true),
      StructField("attrs", MapType(StringType, StringType), nullable = true),
      StructField("orders", ArrayType(StructType(Seq(
        StructField("sku", StringType, nullable = true),
        StructField("qty", IntegerType, nullable = true)
      ))), nullable = true)
    ))
    val nestedRows = (1 to 500).map { i =>
      org.apache.spark.sql.Row(
        i,
        org.apache.spark.sql.Row(s"First$i", s"Last$i", i * 0.5),
        Seq(s"tag${i % 7}", s"tag${i % 3}"),
        Map("env" -> (if (i % 2 == 0) "prod" else "dev"), "tier" -> s"t${i % 4}"),
        Seq(org.apache.spark.sql.Row(s"SKU-$i", i % 9), org.apache.spark.sql.Row(s"SKU-B$i", i % 5))
      )
    }
    spark.createDataFrame(spark.sparkContext.parallelize(nestedRows), nestedSchema)
      .coalesce(1).write.mode(SaveMode.Overwrite).parquet(out("nested"))

    // 5. wide: 200 columns, the horizontal-virtualization stress case
    println("[fixtures] wide")
    val base = spark.range(0, 2000).toDF("id")
    val wide = (1 to 199).foldLeft(base) { (df, c) =>
      df.withColumn(s"col_$c", (col("id") * c).cast(if (c % 3 == 0) "string" else "double"))
    }
    wide.coalesce(2).write.mode(SaveMode.Overwrite).parquet(out("wide"))

    // 6. nulls: heavy nullability across every type
    println("[fixtures] nulls")
    val nulls = (1 to 5000).map { i =>
      (
        i,
        if (i % 3 == 0) null else s"name_$i",
        if (i % 4 == 0) null else java.lang.Double.valueOf(i * 2.5),
        if (i % 5 == 0) null else java.lang.Boolean.valueOf(i % 2 == 0),
        if (i % 7 == 0) null else java.lang.Long.valueOf(i.toLong * 1000)
      )
    }.toDF("id", "name", "amount", "flag", "big")
    nulls.coalesce(2).write.mode(SaveMode.Overwrite).parquet(out("nulls"))

    // 7. zstd: non-default codec, exercises hyparquet-compressors
    println("[fixtures] zstd")
    val z = (1 to 10000).map(i => (i, s"payload_${i}_${"x" * (i % 50)}", i * 1.25))
      .toDF("id", "payload", "amount")
    z.coalesce(2).write.mode(SaveMode.Overwrite)
      .option("compression", "zstd").parquet(out("zstd"))

    // 8. gzip: another codec path
    println("[fixtures] gzip")
    z.coalesce(1).write.mode(SaveMode.Overwrite)
      .option("compression", "gzip").parquet(out("gzip"))

    // 9. timestamps: INT96 legacy vs INT64 modern, a real Spark gotcha
    println("[fixtures] timestamps-int96")
    val ts = (1 to 2000).map { i =>
      (i, new java.sql.Timestamp(1700000000000L + i * 3600000L))
    }.toDF("id", "event_at")
    spark.conf.set("spark.sql.parquet.outputTimestampType", "INT96")
    ts.coalesce(1).write.mode(SaveMode.Overwrite).parquet(out("timestamps-int96"))
    spark.conf.set("spark.sql.parquet.outputTimestampType", "TIMESTAMP_MICROS")
    ts.coalesce(1).write.mode(SaveMode.Overwrite).parquet(out("timestamps-micros"))

    // 10. decimals: Spark DecimalType is invisible in raw parquet physical types
    println("[fixtures] decimals")
    val dec = (1 to 1000).map(i => (i, BigDecimal(i) / 100))
      .toDF("id", "price")
      .withColumn("price", col("price").cast(DecimalType(18, 4)))
    dec.coalesce(1).write.mode(SaveMode.Overwrite).parquet(out("decimals"))

    // 11. manyrowgroups: small row-group size so statistics-based skipping is observable
    println("[fixtures] manyrowgroups")
    val rg = (1 to 200000).map(i => (i, i % 1000, s"s_${i % 50}")).toDF("id", "bucket", "label")
    rg.sort("bucket").coalesce(1).write.mode(SaveMode.Overwrite)
      .option("parquet.block.size", (256 * 1024).toString)
      .parquet(out("manyrowgroups"))

    // 12. schema-mismatch: two parts that disagree, must surface as an error not a crash
    println("[fixtures] schema-mismatch")
    val a = (1 to 100).map(i => (i, s"n_$i")).toDF("id", "name")
    val b = (1 to 100).map(i => (i, i * 1.5)).toDF("id", "score")
    a.coalesce(1).write.mode(SaveMode.Overwrite).parquet(out("schema-mismatch"))
    b.coalesce(1).write.mode(SaveMode.Overwrite).parquet(out("_tmp-mismatch-b"))
    val mismatchDir = Paths.get(out("schema-mismatch"))
    val tmpB = Paths.get(out("_tmp-mismatch-b"))
    Files.list(tmpB).filter(p => p.getFileName.toString.endsWith(".parquet")).forEach { p =>
      Files.copy(p, mismatchDir.resolve("part-99999-mismatched-c000.snappy.parquet"),
        StandardCopyOption.REPLACE_EXISTING)
    }
    def rmrf(p: java.io.File): Unit = {
      if (p.isDirectory) p.listFiles().foreach(rmrf)
      p.delete()
    }
    rmrf(new java.io.File(out("_tmp-mismatch-b")))

    // 13. empty: zero rows but a valid schema
    println("[fixtures] empty")
    simple.filter(lit(false)).coalesce(1).write.mode(SaveMode.Overwrite).parquet(out("empty"))

    // 14. big: the perf fixture. Gitignored, opt-in via --big.
    if (withBig) {
      println("[fixtures] big (this takes a few minutes)")
      val rnd = new Random(42)
      val bigBase = spark.range(0, 5000000).toDF("id")
      val big = (1 to 39).foldLeft(bigBase) { (df, c) =>
        c % 4 match {
          case 0 => df.withColumn(s"str_$c", concat(lit(s"v${c}_"), (col("id") % 9973).cast("string")))
          case 1 => df.withColumn(s"dbl_$c", (col("id") * 0.37 + c).cast("double"))
          case 2 => df.withColumn(s"int_$c", (col("id") % (c * 137 + 7)).cast("int"))
          case _ => df.withColumn(s"bool_$c", (col("id") % (c + 2)) === 0)
        }
      }
      big.repartition(16).write.mode(SaveMode.Overwrite).parquet(out("big"))
    }

    println("[fixtures] done -> " + outRoot)
    spark.stop()
  }
}
