import org.apache.spark.sql.{Row, SaveMode, SparkSession}
import org.apache.spark.sql.types._

/**
 * Deeply recursive nesting: the shapes that break naive parquet readers.
 * Parquet stores these with definition and repetition levels, and reassembling
 * them wrongly is the classic source of silent corruption.
 */
object GenerateDeepFixture {

  def main(args: Array[String]): Unit = {
    val outRoot = if (args.nonEmpty) args(0) else "fixtures"

    val spark = SparkSession.builder()
      .appName("parquet-lens-deep")
      .master("local[*]")
      .config("spark.ui.enabled", "false")
      .getOrCreate()
    spark.sparkContext.setLogLevel("WARN")

    val leaf = StructType(Seq(
      StructField("value", StringType, nullable = true),
      StructField("n", IntegerType, nullable = true),
    ))
    val l4 = StructType(Seq(StructField("leaf", leaf, nullable = true)))
    val l3 = StructType(Seq(StructField("l4", l4, nullable = true)))
    val l2 = StructType(Seq(StructField("l3", l3, nullable = true)))
    val l1 = StructType(Seq(StructField("l2", l2, nullable = true)))

    val childStruct = StructType(Seq(
      StructField("name", StringType, nullable = true),
      StructField("leaf", StructType(Seq(StructField("x", IntegerType, nullable = true))), nullable = true),
    ))
    val treeStruct = StructType(Seq(
      StructField("name", StringType, nullable = true),
      StructField("children", ArrayType(childStruct, containsNull = true), nullable = true),
    ))

    val entryStruct = StructType(Seq(
      StructField("k", StringType, nullable = true),
      StructField("v", ArrayType(DoubleType, containsNull = true), nullable = true),
    ))

    val schema = StructType(Seq(
      StructField("id", IntegerType, nullable = false),
      // five levels of struct
      StructField("deep", l1, nullable = true),
      // array of array of array
      StructField("matrix", ArrayType(ArrayType(ArrayType(IntegerType, true), true), true), nullable = true),
      // map -> array -> struct -> array
      StructField("index", MapType(StringType, ArrayType(entryStruct, true), true), nullable = true),
      // array -> struct -> array -> struct -> struct
      StructField("tree", ArrayType(treeStruct, containsNull = true), nullable = true),
      // map of map
      StructField("nestedMap", MapType(StringType, MapType(StringType, IntegerType, true), true), nullable = true),
      // array of map
      StructField("arrayOfMap", ArrayType(MapType(StringType, StringType, true), true), nullable = true),
    ))

    val rows = (1 to 300).map { i =>
      // every 5th row goes null at a different depth, so reassembly is exercised
      val deep =
        if (i % 5 == 0) null
        else Row(Row(Row(Row(
          if (i % 7 == 0) null else Row(s"deep_$i", i)
        ))))

      val matrix =
        if (i % 11 == 0) null
        else Seq(
          Seq(Seq(i, i + 1), if (i % 3 == 0) null else Seq(i + 2)),
          if (i % 4 == 0) null else Seq(Seq(i * 10), Seq.empty[Int]),
        )

      val index =
        if (i % 13 == 0) null
        else Map(
          "a" -> Seq(Row(s"k$i", Seq(i * 1.5, i * 2.5)), Row(null, null)),
          "b" -> (if (i % 6 == 0) null else Seq(Row(s"b$i", Seq.empty[Double]))),
        )

      val tree =
        if (i % 17 == 0) null
        else Seq(
          Row(s"root_$i", Seq(
            Row(s"child_${i}_1", Row(i)),
            Row(s"child_${i}_2", if (i % 8 == 0) null else Row(i * 2)),
          )),
          Row(s"root2_$i", if (i % 9 == 0) null else Seq.empty[Row]),
        )

      val nestedMap =
        if (i % 19 == 0) null
        else Map("outer" -> Map("inner" -> i, "other" -> (i * 3)))

      val arrayOfMap =
        if (i % 23 == 0) null
        else Seq(Map("x" -> s"v$i"), if (i % 10 == 0) null else Map("y" -> s"w$i"))

      Row(i, deep, matrix, index, tree, nestedMap, arrayOfMap)
    }

    spark.createDataFrame(spark.sparkContext.parallelize(rows), schema)
      .coalesce(1)
      .write.mode(SaveMode.Overwrite)
      .parquet(s"$outRoot/deep-nested")

    println("[fixtures] deep-nested written")
    spark.stop()
  }
}
