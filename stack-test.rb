#!/usr/bin/env ruby

#
# Intro
# -----
#
# We recognize that doing a coding exercise at a whiteboard during an
# interview is stressful and likely doesn't represent how you would do if you
# were to work on a problem in your own time, in a comfortable environment.
#
# Instead, we're asking you to do spend a few hours on writing a stack server
# that passes this test suite.
#
# We're always open to feedback about the exercise and the process as a whole.
# Please let us know if you have any ideas on how we can improve.
#
# If you have questions or get stuck during the exercise, please reach out to
# your interviewer on the private Slack channel that you received by email.
#
# Getting started
# ---------------
#
# You'll need Ruby 2.3.0 or greater. Consider rvm [https://rvm.io/] to get
# that installed. You can then run this test suite as follows:
#
#   $ ruby stack-test.rb
#
# If you want to run a specific test you can use -n, as follows:
#
#   $ ruby stack-test.rb -n test_single_request
#
# What to submit
# --------------
#
# If you write a single file, send us that. If there are multiple files, put
# them in a tarball or zipfile and send it along with instructions. Either
# way, make sure to write any required instructions in the email or a supplied
# README file.
#
# What we look at
# ---------------
#
# Besides counting the number of tests that your server passes/fails, there is
# no easily quantifiable procedure to evaluating someone's code.
#
# We will look for correctness by running a more extensive test suite than
# this one; and, of course, by close code inspection. We pay attention to the
# potential for race conditions, busy loops, the exact order in which your
# server handles requests, performs stack operations, and issues responses. We
# look at how you structured the code and how easy or hard it is to
# understand.
#
# Finally: bad layout and indentation, lots of stale, unused, or commented out
# code, and trailing white space will make your code look unnecessarily bad.
# Conditional logging is encouraged. Spaghetti code is frowned upon. Aim for
# code that you would be proud to deploy to a live server.
#
# Stack server
# ------------
#
# Write a server that manages a LIFO stack, supporting push and pop
# operations. The server listens for requests from clients connecting over TCP
# on port 8080. The server should respond to the request and then close the
# connection.
#
# A push request pushes the given payload onto the stack. However, the stack
# can have no more than 100 items on it. Push requests for a full stack should
# block until stack space becomes available. (This is similar to how HTTP
# long-polling works.)
#
# A pop request returns the top item from the stack to the client. If the
# stack is empty, the pop request should block until an item becomes available
# on the stack. (This, again, is similar to how HTTP long-polling works.)
#
# Both push and pop requests should be served (and their associated stack
# operations performed) in the order in which they arrive fully. Note that
# this is not necessarily the order in which the server accepts TCP
# connections: some clients may be very slow to write their requests. Clients
# that connect later may 'overtake' slower clients that are still writing
# their request. Those fast clients should get their response before the slow
# clients.
#
# The server should not have to juggle more than 100 clients simultaneously.
# Additional client connections should be rejected by sending a single byte
# response indicating busy-state and then immediately disconnected. (Strictly
# speaking, this means that there is a very brief period during which the
# server is handling more than 100 simultaneous connections--but only long
# enough to dismiss those additional clients.)
#
# However, there is an exception to this rule. To prevent deadlock (eg, 100
# pop requests all waiting for a push request that is always rejected) the
# server must free up resources under specific conditions. If the server is
# already handling 100 connections and a new client tries to connect, it must
# disconnect the oldest client, provided their connection is older than 10
# seconds. The server should only disconnect an old client when provoked by a
# new incoming client connection that would otherwise have to be rejected. It
# should not just disconnect old clients for no reason.
#
# A push request format is as follows. The first byte is the header. The rest
# of the request is the payload. The most significant bit in the header byte
# is 0; the 7 remaining bits are the length of the payload, in bytes. (As
# such, the minimum size for a push request is 2 bytes: 1 header byte and 1
# payload byte. The maximum size for a push request is 128 bytes: 1 header
# byte and 127 payload bytes.)
#
# The format of a pop request is a single byte with the most significant bit
# set to 1. The rest of the byte is ignored.
#
# The format of a push response is 1 byte, all zeros.
#
# The format of a pop response is 1 header byte, with the most significant bit
# set to 0 and the rest of the payload indicating the payload size. The rest
# of the response is the payload indicated number of bytes of payload.
#
# The format of a busy-state response is 1 byte, value 0xFF.
#
# You have to assume little-endian byte ordering, the default on x86
# architectures. Bytes are sent in network order.
#
#
# Another simplifying assumption you get to make is that once you pop
# something off the stack, that's it. You don't have to put it back on the
# stack if it turns out you can't write the response to the client (for
# example, if they disconnected).
#
# You might find it useful to implement a listening socket on, say, port 8081
# that prints out the state of the stack (and other debugging info you might
# need) and then closes the connection. This is optional, of course.
#
# This test suite assumes the server starts out with an empty stack. If this
# test suite crashes you should restart the server before running the test
# suite again. You are welcome to modify the server to implement a reset code
# (probably by interpreting the otherwise ignored remaining 7 bits in a pop
# request). Alternatively, have the server listen on another port over which
# you can send reset commands in setup or teardown.
#
# The test suite will cleanly close all of its connections when the teardown
# runs after each test. Your code will need to account for, and cleanup closed
# connections. To do this in a POSIX world, you must attempt to read from the
# socket; if your read call returns 0, then the connection has been closed.
# See the man page on recv:
# http://man7.org/linux/man-pages/man2/recv.2.html#RETURN_VALUE
#
# You conveniently--and falsely--get to assume (and need to ensure) that
# sockets are always closed completely. In other words, the client and the
# server will not close the socket only for reading or writing, while keeping
# the other half open. Phrased differently, if the return value of a read()
# call on a socket indicates that the connection is closed, you can assume the
# connection is also closed for writing. The inverse is true, also.
#
# This test suite is representative, but not comprehensive. We encourage you
# to write more tests, but this is not required.
#
# You are welcome to write this in the language of your choice! You should
# pick a language that you are very comfortable with; don't try an implemention
# in CuttingEdgeLanguage2000 just because you think it will impress us.
# We'd rather see a clean solution in BoringOldLanguage. You may use whichever
# libraries you wish, but please provide clear installation instructions.
#

require 'socket'
require 'test/unit'
require 'base64'
require 'timeout'

if RUBY_VERSION < "2.3.0"
  puts "You need at least ruby version 2.3.0; see https://rvm.io/"
  exit 1
end

Thread.abort_on_exception = true
STDOUT.sync = true

class StackTest < Test::Unit::TestCase
  def setup
    @thread_pool = []
  end

  def teardown
    @thread_pool.each do |t|
      next if !t.alive?
      (t[:socket].shutdown rescue t[:socket].close) if t[:socket]
      t.kill
      t.join
    end
  end

  #
  # issues one push and one pop
  #
  def test_single_request
    puts "test_single_request"
    s = random_string
    pr = push(s)
    assert_equal(0, pr, "expected 0, got #{pr}")
    r = pop()
    assert_equal(s, r, "expected #{s}, got #{r}")
  end

  #
  # issues N pushes, then N pops.
  #
  def test_serialized_requests
    puts "test_serialized_requests"
    30.times do
      ntimes = rand(10)
      expects = []
      ntimes.times do
        expects << random_string
        pr = push(expects[-1])
        assert_equal(0, pr, "expected 0, got #{pr}")
      end

      ntimes.times do
        r = pop
        s = expects.pop
        assert_equal(s, r, "expected #{s}, got #{r}")
      end
    end
  end

  #
  # issues 100 pushes, then 100 pops; a number of times
  #
  def test_full_stack_push_and_pop
    puts "test_full_stack_push_and_pop"
    (rand(10) + 2).times do
      expects = []
      100.times do
        expects << random_string
        pr = push(expects[-1])
        assert_equal(0, pr, "expected 0, got #{pr}")
      end

      100.times do
        r = pop
        s = expects.pop
        assert_equal(s, r, "expected #{s}, got #{r}")
      end
    end
  end

  #
  # randomly interleaves pushes and pops, expects pops to be handled in
  # reverse order of the pushes.
  #
  # to avoid race conditions, we impose a strict ordering between pushes and
  # pops and track, internally, the state in which we believe the server to
  # be.
  #
  # avoid a scenario in which we attempt a push on an empty stack; that will
  # cause the client to deadlock.
  #
  def test_interleaved_requests
    puts "test_interleaved_requests"
    30.times do
      mutex = Mutex.new
      ntimes = rand(50)
      stack = []

      t = Thread.new do
        ntimes.times do
          while stack.empty?
            sleep(0.05)
          end

          r, s = nil, nil
          mutex.synchronize do
            r = pop
            s = stack.pop
          end
          assert_equal(s, r, "expected #{s}, got #{r}")
          sleep(rand(3) / 100.0) if rand(2).zero?
        end
        mutex.unlock if mutex.owned?
      end

      ntimes.times do
        mutex.synchronize do
          stack << random_string
          pr = push(stack[-1])
          assert_equal(0, pr, "expected 0, got #{pr}")
        end
        sleep(rand(3) / 100.0) if rand(2).zero?
      end
      mutex.unlock if mutex.owned?

      t.join
    end
  end

  #
  # fires off a pop, waits 2 seconds, then issues the push that the pop should
  # get.
  #
  def test_long_polling_get
    puts "test_long_polling_get"
    s = random_string
    t = Thread.new do
      r = pop
      assert_equal(s, r, "expected #{s}, got #{r}")
    end

    sleep 2
    pr = push(s)
    assert_equal(0, pr, "expected 0, got #{pr}")
    t.join
  end

  #
  # fills up the stack with 100 entries; issues a long polling push. pops one
  # item off the stack, then verifies that the long polling push completes
  # correctly.
  #
  def test_long_polling_push
    puts "test_long_polling_push"
    s1 = nil
    100.times do
      s1 = random_string
      pr = push(s1)
      assert_equal(0, pr, "expected 0, got #{pr}")
    end

    # start the long polling push
    s2 = random_string
    t = Thread.new do
      pr = push(s2)
      assert_equal(0, pr, "expected 0, got #{pr}")
    end
    sleep 2

    r1 = pop
    assert_equal(s1, r1, "expected #{s1}, got #{r1}")

    # now the long polling push should succeed
    r2 = pop
    assert_equal(s2, r2, "expected #{s2}, got #{r2}")
    t.join

    99.times do
      pop
    end
  end

  #
  # issues a whole bunch of pops that should all block. They all time out,
  # which should clean up state in the server. Then a regular push/pop should
  # succeed.
  #
  def test_pops_to_empty_stack
    puts "test_pops_to_empty_stack"
    threads = []
    100.times do
      threads << Thread.new do
        r = pop(:timeout => 2)
        assert_equal(nil, r, "expected nil, got #{r}")
      end
    end
    threads.each {|t| t.join}

    test_single_request
  end

  #
  # fills up the stack; then issues another push, which should block (because
  # the stack is full), it will time out, then the 100 pops should obtain the
  # objects on the full stack.
  #
  def test_full_stack_ignore
    puts "test_full_stack_ignore"
    expects = []
    100.times do
      expects << random_string
      pr = push(expects[-1])
      assert_equal(0, pr, "expected 0, got #{pr}")
    end

    (rand(5) + 2).times do
      r = push("too full", :timeout => 3)
      assert_equal(nil, r, "expected nil, got #{r}")
    end

    100.times do |i|
      r = pop
      s = expects.pop
      assert_equal(s, r, "expected #{s}, got #{r}")
    end
  end

  #
  # issue 100 very slow push requests. The next one should get a busy-byte
  #
  def test_server_resource_limit
    puts "test_server_resource_limit"
    start_slow_clients(nclients: 100)
    sleep 5

    (rand(6)+1).times do
      r = push(random_string)
      assert_equal(0xFF, r, "expected busy-state response")
    end
  end

  #
  # issue 100 simultaneous slow pushes. the 101st should work after the first
  # 100 have been marked as slow.
  #
  def test_slow_client_gets_killed_for_fast_client
    puts "test_slow_clients_get_killed_for_fast_client"
    start_slow_clients(nclients: 100)
    sleep 12
    test_single_request
  end

  #
  # issue 100 simultaneous slow pushes. only one should get killed for a full
  # 100-push-100-pop sequence to successfully complete
  #
  def test_one_slow_client_gets_killed_for_fast_clients
    puts "test_one_slow_client_gets_killed_for_fast_clients"
    start_slow_clients(nclients: 100)
    sleep 12
    test_full_stack_push_and_pop
  end

  #
  # test that the oldest client gets killed for a new one
  #
  def test_slowest_client_gets_killed
    puts "test_slowest_client_gets_killed"
    # start slow client
    r = nil
    t = Thread.new do
      r = push(random_string(15), :maxsend => 1, :sleep => 1)
    end
    sleep 3 # race condition, sort of, but meh

    # start another 99 slow clients for a string of 12 bytes; we expect these
    # to complete successfully, ie, 1 byte containing 0x00 response expected
    expects = start_slow_clients(nclients: 99, string_size: 12, push_responses: [0])
    sleep 8

    # should kill the oldest client
    test_single_request
    t.join
    assert_equal(nil, r, "expected nil, got #{r}")

    # ensure all 99 threads are done writing their string
    @thread_pool.each {|tx| tx.join}

    # don't care about the order, but do care about all strings being there
    99.times do
      r = pop
      assert(expects.include?(r), "expected #{r} to exist in expects[]")
      expects.delete(r)
    end
  end

  #
  # push 10 items,
  # start writing a push request, but die halfway through
  # pop 10 items
  #
  def test_server_survives_half_message
    puts "test_server_survives_half_message"

    expects = []
    10.times do
      expects << random_string
      pr = push(expects[-1])
      assert_equal(0, pr, "expected 0, got #{pr}")
    end

    s = random_string(15)
    header = s.length
    client = tcp_socket()
    nbytes = client.send([header].pack("C1"), 0)
    if nbytes != 1
      raise "push: header write failed"
    end

    client.send(s[0..3], 0)
    client.shutdown

    10.times do
      r = pop
      s = expects.pop
      assert_equal(s, r, "expected #{s}, got #{r}")
    end
  end


  #
  # push 10 items,
  # start writing a push request, stop halfway through
  # pop 5 items
  # finish writing the push request
  # pop that item
  # pop the remaining 5 items
  #
  def test_server_queues_slow_message_correctly
    puts "test_server_queues_slow_message_correctly"

    expects = []
    10.times do
      expects << random_string
      pr = push(expects[-1])
      assert_equal(0, pr, "expected 0, got #{pr}")
    end

    # send 1 byte of slow string
    slow_s = random_string(2)
    header = slow_s.length
    client = tcp_socket()
    nbytes = client.send([header].pack("C1"), 0)
    if nbytes != 1
      raise "push: header write failed"
    end

    client.send(slow_s[0], 0)

    5.times do
      r = pop
      s = expects.pop
      assert_equal(s, r, "expected #{s}, got #{r}")
    end

    # send second byte of slow string, pop it
    client.send(slow_s[1], 0)
    r = pop
    assert_equal(slow_s, r, "expected #{slow_s}, got #{r}")

    5.times do
      r = pop
      s = expects.pop
      assert_equal(s, r, "expected #{s}, got #{r}")
    end
  end

  def test_slow_clients_are_not_disconnected_for_no_reason
    puts "test_slow_clients_are_not_disconnected_for_no_reason"
    expects = []
    100.times do
      expects << random_string
      pr = push(expects[-1])
      assert_equal(0, pr, "expected 0, got #{pr}")
    end

    sleep 12
    100.times do
      r = pop
      s = expects.pop
      assert_equal(s, r, "expected #{s}, got #{r}")
    end
  end

protected

  def random_string(length = 8)
    Base64.encode64(Random.new.bytes(length)).strip[0..(length-1)]
  end

  def tcp_socket
    Thread.current[:socket] = TCPSocket.new("localhost", 8080)
  end

  #
  # performs a push of the given string.
  # optional arguments
  #
  # :timeout => timeout to the whole operation; does a close on timeout
  # :maxsend => send at most this many bytes in a send; default no limit
  # :sleep => sleep this much between each send; default no sleep
  #
  # an optional block passed to push() is invoked after each send()
  #
  def push(s, args = {})
    client = nil
    _push = proc do
      header = s.length
      client = tcp_socket()

      begin
        nbytes = client.send([header].pack("C1"), 0)
        if nbytes != 1
          raise "push: header write failed"
        end

        nbytes = 0
        maxsend = args[:maxsend] || s.length
        while nbytes < s.length
          bytes_left_to_send = s.length - nbytes
          nbytes_to_send = [bytes_left_to_send, maxsend].min
          substring_to_send = s[nbytes..(nbytes+nbytes_to_send-1)]
          nbytes += client.send(substring_to_send, 0)
          if block_given?
            yield
          end
          sleep(args[:sleep]) if args[:sleep]
        end
      rescue Errno::EPIPE, Errno::ECONNRESET
        #server might have been busy and closed the connection
      end

      r = nil
      begin
        r = client.recv(1).unpack("C1")[0]
      rescue Errno::EPIPE, Errno::ECONNRESET
        #server might have been busy and closed the connection
      end

      # maybe nil if the connection was killed
      if ![0xFF, 0, nil].include?(r)
        raise "invalid push response #{r.inspect}"
      end
      return r
    end

    r = nil
    if args[:timeout]
      begin
        Timeout::timeout(args[:timeout]) do
          r = _push.call
        end
      rescue Timeout::Error
      end
    else
      r = _push.call
    end

    return r
  ensure
    if !client.nil?
      client.close
    end
  end

  def pop(args = {})
    client = tcp_socket()

    _pop = proc do
      begin
        client.send([0x80].pack("C1"), 0)
      rescue Errno::EPIPE
        #server might have been busy and closed the connection
      end
      begin
        header = client.recv(1).unpack("C1")[0]
      rescue Errno::EPIPE, Errno::ECONNRESET
        return nil # If the server disconnects because it has been > 10s since start
      end
      # busy byte
      if (header == 0xFF)
        return 0xFF
      end

      # invalid pop response
      if ((header & 0x80) != 0)
        raise "invalid pop response #{header.inspect}"
      end

      payload_length = header & 0x7f
      payload = ""
      begin
        while payload.length < payload_length
          payload += client.recv(payload_length)
        end
      rescue Errno::EPIPE, Errno::ECONNRESET
        return nil # If the server disconnects because it has been > 10s since start
      end
      return payload
    end

    r = nil
    if args[:timeout]
      begin
        Timeout::timeout(args[:timeout]) do
          r = _pop.call
        end
      rescue Timeout::Error
      end
    else
      r = _pop.call
    end

    return r
  ensure
    if !client.nil?
      client.close
    end
  end

  def start_slow_clients(nclients: 100, string_size: 127, push_responses: [nil])
    mutex = Mutex.new
    count = 0
    expects = []
    nclients.times do
      @thread_pool << Thread.new do
        added_count = false
        s = random_string(string_size)
        expects << s
        pr = push(s, :maxsend => 1, :sleep => 1) do
          if !added_count
            mutex.synchronize { count += 1 }
            added_count = true
          end
        end
        assert(push_responses.include?(pr), "expected one of #{push_responses.inspect}, got #{pr}")
      end
    end

    # wait for all threads to have written at least 1 character
    while count != nclients
      sleep (0.01)
    end

    expects
  end
end
